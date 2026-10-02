import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../src/server/app.js";
import { createLocalAuth } from "../src/server/identity.js";
import type { Database } from "../src/server/db.js";

let sql: PGlite;
let db: Database;
const origin = "http://127.0.0.1:5173";
before(async () => {
  sql = new PGlite();
  for (const name of (await readdir("db/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await sql.exec(await readFile(`db/migrations/${name}`, "utf8"));
  db = { transaction: (work) => sql.transaction((tx) => work(tx)) };
});
after(async () => sql.close());

function api(secureCookies = false) {
  const auth = createLocalAuth(db, { origin, secureCookies });
  const server = createApp(db, auth.resolveIdentity, auth).listen(
    0,
    "127.0.0.1",
  );
  return {
    async request(
      path: string,
      method = "GET",
      body?: unknown,
      cookie?: string,
      csrf?: string,
      requestOrigin = origin,
      extraHeaders: Record<string, string> = {},
    ) {
      if (!server.listening)
        await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method,
        headers: {
          ...(method === "GET" ? {} : { origin: requestOrigin }),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cookie ? { cookie } : {}),
          ...(csrf ? { "x-csrf-token": csrf } : {}),
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        json: await response.json(),
        cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
        setCookie: response.headers.get("set-cookie") ?? "",
      };
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

const credentials = (email: string) => ({
  email,
  password: "correct horse battery staple",
  displayName: "Pemilik Farm",
});

test("registration creates a private session and a user can access only their own farm", async () => {
  const app = api();
  try {
    const first = await app.request(
      "/api/auth/register",
      "POST",
      credentials(`one-${randomUUID()}@example.test`),
    );
    assert.equal(first.status, 200);
    assert.match(first.setCookie, /HttpOnly/);
    assert.match(first.setCookie, /SameSite=Lax/);
    assert.ok(first.cookie);
    assert.ok(first.json.data.csrfToken);
    const farm = await app.request(
      "/api/farms",
      "POST",
      { idempotencyKey: randomUUID(), name: "Farm Satu" },
      first.cookie,
      first.json.data.csrfToken,
    );
    assert.equal(farm.status, 200);
    assert.equal(
      (await app.request("/api/farms", "GET", undefined, first.cookie)).json
        .data.length,
      1,
    );
    const second = await app.request(
      "/api/auth/register",
      "POST",
      credentials(`two-${randomUUID()}@example.test`),
    );
    assert.equal(second.status, 200);
    assert.equal(
      (await app.request("/api/farms", "GET", undefined, second.cookie)).json
        .data.length,
      0,
    );
    assert.equal(
      (
        await app.request(
          `/api/farms/${farm.json.data.id}`,
          "GET",
          undefined,
          second.cookie,
        )
      ).status,
      403,
    );
  } finally {
    await app.close();
  }
});

test("forged identity header, forged cookie, and expired session are rejected", async () => {
  const app = api();
  try {
    const signup = await app.request(
      "/api/auth/register",
      "POST",
      credentials(`third-${randomUUID()}@example.test`),
    );
    const actor = signup.json.data.user.id;
    assert.equal(
      (
        await app.request(
          "/api/farms",
          "GET",
          undefined,
          `opsmart_session=${actor}`,
          undefined,
          origin,
          { "x-user-id": actor },
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await app.request(
          "/api/farms",
          "GET",
          undefined,
          "opsmart_session=forged",
        )
      ).status,
      401,
    );
    await sql.query(
      "UPDATE auth_session SET expires_at=now()-interval '1 minute' WHERE auth_subject=(SELECT auth_subject FROM app_user WHERE id=$1)",
      [actor],
    );
    assert.equal(
      (await app.request("/api/farms", "GET", undefined, signup.cookie)).status,
      401,
    );
  } finally {
    await app.close();
  }
});

test("login throttles repeated failures, including valid credentials during lockout", async () => {
  const app = api();
  try {
    const account = credentials(`limit-${randomUUID()}@example.test`);
    await app.request("/api/auth/register", "POST", account);
    for (let attempt = 0; attempt < 5; attempt++)
      assert.equal(
        (
          await app.request("/api/auth/login", "POST", {
            email: account.email,
            password: "wrong",
          })
        ).status,
        401,
      );
    assert.equal(
      (
        await app.request("/api/auth/login", "POST", {
          email: account.email,
          password: account.password,
        })
      ).status,
      401,
    );
    await sql.query(
      "UPDATE auth_login_throttle SET blocked_until=now()-interval '1 minute',window_started_at=now()-interval '16 minutes' WHERE email_hash=$1",
      [createHash("sha256").update(account.email).digest("hex")],
    );
    assert.equal(
      (
        await app.request("/api/auth/login", "POST", {
          email: account.email,
          password: account.password,
        })
      ).status,
      200,
    );
  } finally {
    await app.close();
  }
});

test("production cookies use Secure and __Host prefix", async () => {
  const app = api(true);
  try {
    const signup = await app.request(
      "/api/auth/register",
      "POST",
      credentials(`secure-${randomUUID()}@example.test`),
    );
    assert.equal(signup.status, 200);
    assert.match(signup.setCookie, /^__Host-opsmart_session=/);
    assert.match(signup.setCookie, /; Secure/);
  } finally {
    await app.close();
  }
});

test("CSRF and origin guards cover mutations and logout revokes the session", async () => {
  const app = api();
  try {
    const signup = await app.request(
      "/api/auth/register",
      "POST",
      credentials(`fourth-${randomUUID()}@example.test`),
    );
    const body = { idempotencyKey: randomUUID(), name: "Farm" };
    assert.equal(
      (await app.request("/api/farms", "POST", body, signup.cookie)).status,
      403,
    );
    assert.equal(
      (await app.request("/api/farms", "POST", body, signup.cookie, "wrong"))
        .status,
      403,
    );
    assert.equal(
      (
        await app.request(
          "/api/farms",
          "POST",
          body,
          signup.cookie,
          signup.json.data.csrfToken,
          "https://evil.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await app.request(
          "/api/auth/logout",
          "POST",
          undefined,
          signup.cookie,
          signup.json.data.csrfToken,
        )
      ).status,
      200,
    );
    assert.equal(
      (await app.request("/api/auth/me", "GET", undefined, signup.cookie))
        .status,
      401,
    );
  } finally {
    await app.close();
  }
});

test("login rejects bad password and issues a new session for valid credentials", async () => {
  const app = api();
  try {
    const account = credentials(`login-${randomUUID()}@example.test`);
    await app.request("/api/auth/register", "POST", account);
    assert.equal(
      (
        await app.request("/api/auth/login", "POST", {
          email: account.email,
          password: "bad password",
        })
      ).status,
      401,
    );
    const login = await app.request("/api/auth/login", "POST", {
      email: account.email,
      password: account.password,
    });
    assert.equal(login.status, 200);
    assert.ok(login.cookie);
    assert.equal(
      (await app.request("/api/auth/me", "GET", undefined, login.cookie))
        .status,
      200,
    );
  } finally {
    await app.close();
  }
});

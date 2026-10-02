import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../src/server/app.js";
import type { Database, Sql } from "../src/server/db.js";
import { fixture } from "./fixture.js";

let sql: PGlite;
let db: Database;
before(async () => {
  sql = new PGlite();
  for (const name of (await readdir("db/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await sql.exec(await readFile(`db/migrations/${name}`, "utf8"));
  db = { transaction: (work) => sql.transaction((tx) => work(tx)) };
});
after(async () => {
  await sql.close();
});

async function user() {
  const id = randomUUID();
  await sql.query(
    "INSERT INTO app_user(id,auth_subject,display_name) VALUES($1,$2,$3)",
    [id, `test:${id}`, "TEST USER"],
  );
  return id;
}
function api(actorId: string, database = db) {
  const server = createApp(database, async () => ({ userId: actorId })).listen(
    0,
    "127.0.0.1",
  );
  return {
    async request(path: string, method = "GET", body?: unknown) {
      if (!server.listening)
        await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method,
        headers:
          body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, json: await response.json() };
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}

test("create farm is idempotent and list/get expose only owner records", async () => {
  const actor = await user(),
    app = api(actor),
    key = randomUUID();
  try {
    const body = {
      idempotencyKey: key,
      name: "  Kolam Sejahtera  ",
      location: "Bogor",
    };
    const first = await app.request("/api/farms", "POST", body);
    assert.equal(first.status, 200);
    assert.equal(first.json.data.id, key);
    assert.equal(first.json.data.name, "Kolam Sejahtera");
    assert.deepEqual(await app.request("/api/farms", "POST", body), first);
    const list = await app.request("/api/farms");
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.json.data.map((farm: { id: string }) => farm.id),
      [key],
    );
    assert.equal(
      (await app.request(`/api/farms/${key}`)).json.data.location,
      "Bogor",
    );
    assert.equal(
      (await sql.query("SELECT id FROM farm WHERE id=$1", [key])).rows.length,
      1,
    );
    assert.equal(
      (
        await sql.query(
          "SELECT operation FROM command_receipt WHERE farm_id=$1",
          [key],
        )
      ).rows.length,
      1,
    );
  } finally {
    await app.close();
  }
});

test("changed replay conflicts; another owner cannot list, read, update or claim farm", async () => {
  const actor = await user(),
    foreign = await user(),
    ownerApi = api(actor),
    foreignApi = api(foreign),
    key = randomUUID();
  try {
    const body = { idempotencyKey: key, name: "Farm A" };
    assert.equal(
      (await ownerApi.request("/api/farms", "POST", body)).status,
      200,
    );
    assert.equal(
      (
        await ownerApi.request("/api/farms", "POST", {
          ...body,
          name: "Farm B",
        })
      ).status,
      409,
    );
    assert.equal((await foreignApi.request("/api/farms")).json.data.length, 0);
    assert.equal((await foreignApi.request(`/api/farms/${key}`)).status, 403);
    assert.equal(
      (
        await foreignApi.request(`/api/farms/${key}`, "PATCH", {
          idempotencyKey: randomUUID(),
          name: "Stolen",
        })
      ).status,
      403,
    );
    assert.equal(
      (await foreignApi.request("/api/farms", "POST", body)).status,
      403,
    );
    assert.equal(
      (
        await sql.query<{ name: string }>("SELECT name FROM farm WHERE id=$1", [
          key,
        ])
      ).rows[0]?.name,
      "Farm A",
    );
  } finally {
    await ownerApi.close();
    await foreignApi.close();
  }
});

test("update is idempotent, supports location clear and preserves omitted values", async () => {
  const actor = await user(),
    app = api(actor),
    key = randomUUID();
  try {
    await app.request("/api/farms", "POST", {
      idempotencyKey: key,
      name: "Farm Awal",
      location: "Bogor",
    });
    const update = { idempotencyKey: randomUUID(), name: "Farm Baru" };
    const first = await app.request(`/api/farms/${key}`, "PATCH", update);
    assert.equal(first.status, 200);
    assert.equal(first.json.data.name, "Farm Baru");
    assert.equal(first.json.data.location, "Bogor");
    assert.deepEqual(
      await app.request(`/api/farms/${key}`, "PATCH", update),
      first,
    );
    assert.equal(
      (
        await app.request(`/api/farms/${key}`, "PATCH", {
          ...update,
          name: "Changed",
        })
      ).status,
      409,
    );
    const clear = await app.request(`/api/farms/${key}`, "PATCH", {
      idempotencyKey: randomUUID(),
      location: null,
    });
    assert.equal(clear.status, 200);
    assert.equal(clear.json.data.location, null);
  } finally {
    await app.close();
  }
});

test("validation rejects blank name and empty update without inserting data", async () => {
  const actor = await user(),
    app = api(actor),
    key = randomUUID();
  try {
    assert.equal(
      (
        await app.request("/api/farms", "POST", {
          idempotencyKey: key,
          name: "  ",
        })
      ).status,
      422,
    );
    assert.equal(
      (await sql.query("SELECT id FROM farm WHERE id=$1", [key])).rows.length,
      0,
    );
    const created = await app.request("/api/farms", "POST", {
      idempotencyKey: key,
      name: "Farm",
    });
    assert.equal(created.status, 200);
    assert.equal(
      (
        await app.request(`/api/farms/${key}`, "PATCH", {
          idempotencyKey: randomUUID(),
        })
      ).status,
      422,
    );
  } finally {
    await app.close();
  }
});

test("receipt insert failure rolls back farm creation", async () => {
  const actor = await user(),
    key = randomUUID();
  const broken: Database = {
    transaction: (work) =>
      db.transaction((tx) =>
        work({
          query: <T extends Record<string, unknown>>(
            text: string,
            params?: unknown[],
          ) =>
            text.startsWith("INSERT INTO command_receipt")
              ? Promise.reject(new Error("write failed"))
              : tx.query<T>(text, params),
        } as Sql),
      ),
  };
  const app = api(actor, broken);
  try {
    const response = await app.request("/api/farms", "POST", {
      idempotencyKey: key,
      name: "Rollback",
    });
    assert.equal(response.status, 500);
    assert.equal(
      (await sql.query("SELECT id FROM farm WHERE id=$1", [key])).rows.length,
      0,
    );
    assert.equal(
      (
        await sql.query(
          "SELECT idempotency_key FROM command_receipt WHERE farm_id=$1",
          [key],
        )
      ).rows.length,
      0,
    );
  } finally {
    await app.close();
  }
});

test("archiving keeps related records and blocks further writes on the archived farm", async () => {
  const f = await fixture(sql),
    app = api(f.actorId);
  try {
    const body = { idempotencyKey: randomUUID() };
    const response = await app.request(
      `/api/farms/${f.farmId}/archive`,
      "POST",
      body,
    );
    assert.equal(response.status, 200);
    assert.ok(response.json.data.archivedAt);
    assert.deepEqual(
      await app.request(`/api/farms/${f.farmId}/archive`, "POST", body),
      response,
    );
    assert.equal((await app.request("/api/farms")).json.data.length, 0);
    assert.equal((await app.request(`/api/farms/${f.farmId}`)).status, 200);
    assert.equal(
      (
        await sql.query("SELECT id FROM farming_cycle WHERE farm_id=$1", [
          f.farmId,
        ])
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await app.request(`/api/farms/${f.farmId}`, "PATCH", {
          idempotencyKey: randomUUID(),
          name: "No",
        })
      ).status,
      403,
    );
  } finally {
    await app.close();
  }
});

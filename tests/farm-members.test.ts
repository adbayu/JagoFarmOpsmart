import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../src/server/app.js";
import type { Database } from "../src/server/db.js";

let sql: PGlite;
let db: Database;
before(async () => {
  sql = new PGlite();
  for (const name of (await readdir("db/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await sql.exec(await readFile(`db/migrations/${name}`, "utf8"));
  db = { transaction: (work) => sql.transaction((tx) => work(tx)) };
});
after(async () => sql.close());

async function user() {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await sql.query(
    "INSERT INTO app_user(id,auth_subject,display_name) VALUES($1,$2,$3)",
    [id, `test:${id}`, email],
  );
  await sql.query(
    "INSERT INTO auth_credential(user_id,email,password_salt,password_hash) VALUES($1,$2,'salt','hash')",
    [id, email],
  );
  return { id, email };
}

function api(actorId: string) {
  const server = createApp(db, async () => ({ userId: actorId })).listen(
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
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

test("farm owner adds an account and the member can use the farm", async () => {
  const owner = await user();
  const member = await user();
  const ownerApi = api(owner.id);
  const memberApi = api(member.id);
  const farmId = randomUUID();
  try {
    assert.equal(
      (
        await ownerApi.request("/api/farms", "POST", {
          idempotencyKey: farmId,
          name: "Farm Bersama",
        })
      ).status,
      200,
    );
    const added = await ownerApi.request(
      `/api/farms/${farmId}/members`,
      "POST",
      { idempotencyKey: randomUUID(), email: member.email },
    );
    assert.equal(added.status, 200);
    assert.equal(added.json.data.email, member.email);

    const ownerMembers = await ownerApi.request(`/api/farms/${farmId}/members`);
    assert.equal(ownerMembers.json.data.canManageMembers, true);
    assert.equal(ownerMembers.json.data.members.length, 2);
    assert.equal(
      ownerMembers.json.data.members.find(
        (candidate: { id: string }) => candidate.id === owner.id,
      ).isOwner,
      true,
    );
    assert.equal(
      ownerMembers.json.data.members.find(
        (candidate: { id: string }) => candidate.id === member.id,
      ).isOwner,
      false,
    );
    const memberMembers = await memberApi.request(
      `/api/farms/${farmId}/members`,
    );
    assert.equal(memberMembers.json.data.canManageMembers, false);
    assert.equal(memberMembers.json.data.members[0].email, owner.email);

    const farms = await memberApi.request("/api/farms");
    assert.deepEqual(
      farms.json.data.map((farm: { id: string }) => farm.id),
      [farmId],
    );
    for (const path of [
      `/api/farms/${farmId}/units`,
      `/api/farms/${farmId}/items?limit=50&offset=0`,
      `/api/farms/${farmId}/dashboard`,
      `/api/farms/${farmId}/analytics/production?from=2026-09-01&toExclusive=2026-10-01`,
      `/api/farms/${farmId}/costs?limit=50&offset=0`,
    ])
      assert.equal((await memberApi.request(path)).status, 200, path);
    assert.equal(
      (
        await memberApi.request(`/api/farms/${farmId}`, "PATCH", {
          idempotencyKey: randomUUID(),
          name: "Farm Dikelola Bersama",
        })
      ).status,
      200,
    );
    assert.equal(
      (await ownerApi.request(`/api/farms/${farmId}`)).json.data.name,
      "Farm Dikelola Bersama",
    );
  } finally {
    await ownerApi.close();
    await memberApi.close();
  }
});

test("membership migration backfills existing farm owners", async () => {
  const legacy = new PGlite();
  try {
    for (const name of (await readdir("db/migrations"))
      .filter((name) => name < "008_farm_membership.sql")
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await legacy.exec(await readFile(`db/migrations/${name}`, "utf8"));
    const ownerId = randomUUID();
    const farmId = randomUUID();
    await legacy.query(
      "INSERT INTO app_user(id,auth_subject,display_name) VALUES($1,$2,'Legacy Owner')",
      [ownerId, `test:${ownerId}`],
    );
    await legacy.query(
      "INSERT INTO farm(id,owner_id,name,created_at) VALUES($1,$2,'Existing Farm','2025-01-02T03:04:05Z')",
      [farmId, ownerId],
    );
    await legacy.exec(
      await readFile("db/migrations/008_farm_membership.sql", "utf8"),
    );
    const member = await legacy.query<{
      user_id: string;
      added_by: string;
      joined_at: Date;
    }>(
      "SELECT user_id,added_by,joined_at FROM farm_membership WHERE farm_id=$1",
      [farmId],
    );
    assert.deepEqual(member.rows[0], {
      user_id: ownerId,
      added_by: ownerId,
      joined_at: new Date("2025-01-02T03:04:05Z"),
    });
  } finally {
    await legacy.close();
  }
});

test("only the farm owner can add members", async () => {
  const owner = await user();
  const member = await user();
  const nextMember = await user();
  const ownerApi = api(owner.id);
  const memberApi = api(member.id);
  const farmId = randomUUID();
  try {
    assert.equal(
      (
        await ownerApi.request("/api/farms", "POST", {
          idempotencyKey: farmId,
          name: "Farm Owner",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await ownerApi.request(`/api/farms/${farmId}/members`, "POST", {
          idempotencyKey: randomUUID(),
          email: member.email,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await memberApi.request(`/api/farms/${farmId}/members`, "POST", {
          idempotencyKey: randomUUID(),
          email: nextMember.email,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await sql.query(
          "SELECT user_id FROM farm_membership WHERE farm_id=$1 AND user_id=$2",
          [farmId, nextMember.id],
        )
      ).rows.length,
      0,
    );
  } finally {
    await ownerApi.close();
    await memberApi.close();
  }
});

test("only the owner can remove a non-owner member and revocation is idempotent", async () => {
  const owner = await user();
  const member = await user();
  const target = await user();
  const outsider = await user();
  const ownerApi = api(owner.id);
  const memberApi = api(member.id);
  const targetApi = api(target.id);
  const outsiderApi = api(outsider.id);
  const farmId = randomUUID();
  try {
    assert.equal(
      (
        await ownerApi.request("/api/farms", "POST", {
          idempotencyKey: farmId,
          name: "Farm Bersama",
        })
      ).status,
      200,
    );
    for (const account of [member, target])
      assert.equal(
        (
          await ownerApi.request(`/api/farms/${farmId}/members`, "POST", {
            idempotencyKey: randomUUID(),
            email: account.email,
          })
        ).status,
        200,
      );
    assert.equal(
      (
        await memberApi.request(`/api/farms/${farmId}`, "PATCH", {
          idempotencyKey: randomUUID(),
          name: "Farm dikelola anggota",
        })
      ).status,
      200,
    );

    const removal = {
      idempotencyKey: randomUUID(),
    };
    const path = `/api/farms/${farmId}/members/${target.id}`;
    assert.equal(
      (await memberApi.request(path, "DELETE", removal)).status,
      403,
    );
    assert.equal((await ownerApi.request(path, "DELETE", removal)).status, 200);
    assert.deepEqual(await ownerApi.request(path, "DELETE", removal), {
      status: 200,
      json: { data: { memberId: target.id } },
    });
    assert.equal(
      (await ownerApi.request(`/api/farms/${farmId}/members`)).json.data.members
        .length,
      2,
    );
    assert.equal((await targetApi.request("/api/farms")).json.data.length, 0);
    assert.equal(
      (await targetApi.request(`/api/farms/${farmId}/members`)).status,
      403,
    );
    assert.equal(
      (await targetApi.request(`/api/farms/${farmId}/units`)).status,
      403,
    );
    assert.equal(
      (
        await outsiderApi.request(path, "DELETE", {
          idempotencyKey: randomUUID(),
        })
      ).status,
      403,
    );

    assert.equal(
      (
        await ownerApi.request(
          `/api/farms/${farmId}/members/${owner.id}`,
          "DELETE",
          {
            idempotencyKey: randomUUID(),
          },
        )
      ).status,
      409,
    );
    const actorReceipt = await sql.query<{ created_by: string }>(
      `SELECT created_by FROM command_receipt
       WHERE farm_id=$1 AND operation='farms.update' AND created_by=$2`,
      [farmId, member.id],
    );
    assert.equal(actorReceipt.rows.length, 1);
  } finally {
    await ownerApi.close();
    await memberApi.close();
    await targetApi.close();
    await outsiderApi.close();
  }
});

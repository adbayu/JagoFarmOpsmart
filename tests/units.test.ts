import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../src/server/app.js";
import type { Database } from "../src/server/db.js";
import { createUnit } from "../src/modules/farming/service.js";

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

async function owner() {
  const actorId = randomUUID(),
    farmId = randomUUID();
  await sql.query(
    "INSERT INTO app_user(id,auth_subject,display_name) VALUES($1,$2,'UNIT TEST')",
    [actorId, `test:${actorId}`],
  );
  await sql.query(
    "INSERT INTO farm(id,owner_id,name) VALUES($1,$2,'Unit Test Farm')",
    [farmId, actorId],
  );
  await sql.query(
    "INSERT INTO farm_membership(farm_id,user_id,added_by) VALUES($1,$2,$2)",
    [farmId, actorId],
  );
  return { actorId, farmId };
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

test("unit HTTP creates a fish unit and lists only units owned by the actor", async () => {
  const { actorId, farmId } = await owner();
  const owned = api(actorId),
    foreign = api((await owner()).actorId);
  try {
    const created = await owned.request(`/api/farms/${farmId}/units`, "POST", {
      idempotencyKey: randomUUID(),
      type: "FISH",
      name: "Kolam A",
      areaM2: "20.500",
      depthM: "1.250",
      capacityHeads: 200,
    });
    assert.equal(created.status, 200);
    assert.ok(created.json.data.unitId);
    const list = await owned.request(`/api/farms/${farmId}/units`);
    assert.equal(list.status, 200);
    assert.equal(list.json.data.length, 1);
    assert.equal(list.json.data[0].type, "FISH");
    assert.equal(list.json.data[0].areaM2, "20.500");
    assert.equal(
      (await foreign.request(`/api/farms/${farmId}/units`)).status,
      403,
    );
  } finally {
    await owned.close();
    await foreign.close();
  }
});

test("each unit type persists exactly one matching detail and can be read", async () => {
  const { actorId, farmId } = await owner();
  const app = api(actorId);
  try {
    const cases = [
      {
        type: "FISH",
        name: "Kolam B",
        areaM2: "12.000",
        depthM: "1.500",
        capacityHeads: 100,
        table: "pond",
      },
      {
        type: "CHICKEN",
        name: "Kandang B",
        areaM2: "15.000",
        capacityHeads: 50,
        table: "coop",
      },
      {
        type: "CROP",
        name: "Lahan B",
        areaM2: "30.000",
        media: "Tanah",
        capacityPlants: 300,
        table: "growing_area",
      },
    ];
    for (const { table, ...body } of cases) {
      const created = await app.request(`/api/farms/${farmId}/units`, "POST", {
        idempotencyKey: randomUUID(),
        ...body,
      });
      assert.equal(created.status, 200);
      const unitId = created.json.data.unitId;
      const detail = await sql.query(
        `SELECT unit_id FROM ${table} WHERE unit_id=$1`,
        [unitId],
      );
      assert.equal(detail.rows.length, 1);
      const read = await app.request(`/api/farms/${farmId}/units/${unitId}`);
      assert.equal(read.status, 200);
      assert.equal(read.json.data.type, body.type);
      assert.equal(read.json.data.name, body.name);
    }
    assert.equal(
      (await app.request(`/api/farms/${farmId}/units`)).json.data.length,
      3,
    );
  } finally {
    await app.close();
  }
});

test("validation, duplicate names, and idempotency protect unit creation", async () => {
  const { actorId, farmId } = await owner();
  const app = api(actorId);
  try {
    const body = {
      idempotencyKey: randomUUID(),
      type: "FISH",
      name: "Kolam C",
      areaM2: "10.000",
    };
    const first = await app.request(`/api/farms/${farmId}/units`, "POST", body);
    assert.equal(first.status, 200);
    assert.deepEqual(
      await app.request(`/api/farms/${farmId}/units`, "POST", body),
      first,
    );
    assert.equal(
      (
        await app.request(`/api/farms/${farmId}/units`, "POST", {
          ...body,
          name: "Different",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await app.request(`/api/farms/${farmId}/units`, "POST", {
          ...body,
          idempotencyKey: randomUUID(),
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await app.request(`/api/farms/${farmId}/units`, "POST", {
          ...body,
          name: "Bad area",
          idempotencyKey: randomUUID(),
          areaM2: "0",
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await app.request(`/api/farms/${farmId}/units`, "POST", {
          ...body,
          name: "Bad subtype",
          idempotencyKey: randomUUID(),
          media: "Tanah",
        })
      ).status,
      422,
    );
    assert.equal(
      (await app.request(`/api/farms/${farmId}/units`)).json.data.length,
      1,
    );
  } finally {
    await app.close();
  }
});

test("detail write failure rolls back parent and receipt", async () => {
  const { actorId, farmId } = await owner();
  const broken: Database = {
    transaction: (work) =>
      db.transaction((tx) =>
        work({
          query: (statement, params) =>
            statement.startsWith("INSERT INTO pond(")
              ? Promise.reject(new Error("injected detail failure"))
              : tx.query(statement, params),
        }),
      ),
  };
  await assert.rejects(
    createUnit(
      broken,
      { actorId, farmId },
      {
        idempotencyKey: randomUUID(),
        type: "FISH",
        name: "Rollback Kolam",
        areaM2: "5.000",
      },
    ),
    /injected detail failure/,
  );
  assert.equal(
    (await sql.query("SELECT id FROM farm_unit WHERE farm_id=$1", [farmId]))
      .rows.length,
    0,
  );
  assert.equal(
    (
      await sql.query(
        "SELECT idempotency_key FROM command_receipt WHERE farm_id=$1",
        [farmId],
      )
    ).rows.length,
    0,
  );
});

test("owner can update; foreign actor cannot read or mutate", async () => {
  const { actorId, farmId } = await owner();
  const app = api(actorId),
    outsider = api((await owner()).actorId);
  try {
    const created = await app.request(`/api/farms/${farmId}/units`, "POST", {
      idempotencyKey: randomUUID(),
      type: "CROP",
      name: "Bedengan",
      areaM2: "8.000",
      media: "Tanah",
    });
    const unitId = created.json.data.unitId;
    const url = `/api/farms/${farmId}/units/${unitId}`;
    assert.equal((await outsider.request(url)).status, 403);
    assert.equal(
      (
        await outsider.request(url, "PATCH", {
          idempotencyKey: randomUUID(),
          type: "CROP",
          name: "Hijack",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await outsider.request(`${url}/archive`, "POST", {
          idempotencyKey: randomUUID(),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await outsider.request(`/api/farms/${farmId}/units`, "POST", {
          idempotencyKey: randomUUID(),
          type: "FISH",
          name: "Foreign",
        })
      ).status,
      403,
    );
    const updated = await app.request(url, "PATCH", {
      idempotencyKey: randomUUID(),
      type: "CROP",
      name: "Bedengan Baru",
      areaM2: "9.250",
      media: null,
      capacityPlants: 100,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.data.areaM2, "9.250");
    assert.equal(updated.json.data.media, null);
    assert.equal(updated.json.data.capacityPlants, 100);
  } finally {
    await app.close();
    await outsider.close();
  }
});

test("updating a pond keeps subtype fields managed by later flows", async () => {
  const { actorId, farmId } = await owner();
  const app = api(actorId);
  try {
    const created = await app.request(`/api/farms/${farmId}/units`, "POST", {
      idempotencyKey: randomUUID(),
      type: "FISH",
      name: "Pond Condition",
    });
    const unitId = created.json.data.unitId;
    await sql.query("UPDATE pond SET condition='READY' WHERE unit_id=$1", [
      unitId,
    ]);
    const changed = await app.request(
      `/api/farms/${farmId}/units/${unitId}`,
      "PATCH",
      { idempotencyKey: randomUUID(), type: "FISH", areaM2: "10.000" },
    );
    assert.equal(changed.status, 200);
    assert.equal(
      (
        await sql.query<{ condition: string }>(
          "SELECT condition FROM pond WHERE unit_id=$1",
          [unitId],
        )
      ).rows[0]?.condition,
      "READY",
    );
  } finally {
    await app.close();
  }
});

test("type can change before a cycle, but not after; active cycles block archive", async () => {
  const { actorId, farmId } = await owner();
  const app = api(actorId);
  try {
    const created = await app.request(`/api/farms/${farmId}/units`, "POST", {
      idempotencyKey: randomUUID(),
      type: "FISH",
      name: "Flexible",
    });
    const unitId = created.json.data.unitId,
      url = `/api/farms/${farmId}/units/${unitId}`;
    const changed = await app.request(url, "PATCH", {
      idempotencyKey: randomUUID(),
      type: "CHICKEN",
      areaM2: "12.000",
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.json.data.type, "CHICKEN");
    assert.equal(
      (await sql.query("SELECT unit_id FROM pond WHERE unit_id=$1", [unitId]))
        .rows.length,
      0,
    );
    assert.equal(
      (await sql.query("SELECT unit_id FROM coop WHERE unit_id=$1", [unitId]))
        .rows.length,
      1,
    );
    const commodityId = randomUUID();
    await sql.query(
      "INSERT INTO commodity(id,farm_id,name,farming_type) VALUES($1,$2,'Ayam Lokal','CHICKEN')",
      [commodityId, farmId],
    );
    const cycleId = randomUUID();
    await sql.query(
      "INSERT INTO farming_cycle(id,farm_id,unit_id,commodity_id,farming_type,name,start_date,created_by) VALUES($1,$2,$3,$4,'CHICKEN','Siklus Tes','2026-01-01',$5)",
      [cycleId, farmId, unitId, commodityId, actorId],
    );
    assert.equal(
      (
        await app.request(url, "PATCH", {
          idempotencyKey: randomUUID(),
          type: "CROP",
          areaM2: "8.000",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await app.request(`${url}/archive`, "POST", {
          idempotencyKey: randomUUID(),
        })
      ).status,
      409,
    );
    await sql.query("UPDATE farming_cycle SET status='ACTIVE' WHERE id=$1", [
      cycleId,
    ]);
    assert.equal(
      (
        await app.request(`${url}/archive`, "POST", {
          idempotencyKey: randomUUID(),
        })
      ).status,
      409,
    );
    await sql.query("UPDATE farming_cycle SET status='COMPLETED' WHERE id=$1", [
      cycleId,
    ]);
    const archiveBody = { idempotencyKey: randomUUID() };
    const archived = await app.request(`${url}/archive`, "POST", archiveBody);
    assert.equal(archived.status, 200);
    assert.equal(archived.json.data.active, false);
    assert.deepEqual(
      await app.request(`${url}/archive`, "POST", archiveBody),
      archived,
    );
    assert.equal(
      (await app.request(`/api/farms/${farmId}/units`)).json.data.length,
      0,
    );
    assert.equal((await app.request(url)).json.data.active, false);
    assert.equal(
      (
        await app.request(url, "PATCH", {
          idempotencyKey: randomUUID(),
          type: "CHICKEN",
          name: "Too late",
        })
      ).status,
      409,
    );
    assert.equal(
      (await sql.query("SELECT id FROM farming_cycle WHERE id=$1", [cycleId]))
        .rows.length,
      1,
    );
  } finally {
    await app.close();
  }
});

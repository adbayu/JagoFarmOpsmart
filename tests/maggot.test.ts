import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "../src/server/db.js";
import { createApp } from "../src/server/app.js";
import {
  addMaggotBatchInput,
  addMaggotObservation,
  completeMaggotBatch,
  createMaggotBatch,
  recordMaggotOutput,
  recordMaggotOutputUse,
} from "../src/modules/maggot/service.js";
import { getMaggotBatch } from "../src/modules/maggot/queries.js";
import { createWasteRecord } from "../src/modules/waste/service.js";
import { fixture } from "./fixture.js";

let sql: PGlite;
let db: Database;
before(async () => {
  sql = new PGlite();
  for (const name of (await readdir("db/migrations"))
    .filter((item) => item.endsWith(".sql"))
    .sort())
    await sql.exec(await readFile(`db/migrations/${name}`, "utf8"));
  db = { transaction: (work) => sql.transaction((tx) => work(tx)) };
});
after(async () => {
  await sql.close();
});

const key = () => randomUUID();

test("maggot batch tracks exact waste input, observations, output use, and remaining without stock changes", async () => {
  const f = await fixture(sql);
  const context = { farmId: f.farmId, actorId: f.actorId };
  const waste = await createWasteRecord(db, context, {
    idempotencyKey: key(),
    source: "Sisa sayur",
    quantity: "5",
    unit: "KG",
    wasteDate: "2026-09-30",
  });
  const before = await sql.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM inventory_movement WHERE farm_id=$1",
    [f.farmId],
  );
  const batch = await createMaggotBatch(db, context, {
    idempotencyKey: key(),
    startedOn: "2026-09-30",
    media: "Dedak",
    notes: "Rak B",
  });
  const input = {
    idempotencyKey: key(),
    wasteId: waste.wasteId,
    quantity: "3",
  };
  const allocated = await addMaggotBatchInput(
    db,
    context,
    batch.batchId,
    input,
  );
  assert.equal(allocated.quantity, "3.000");
  assert.equal(allocated.unit, "KG");
  assert.deepEqual(
    await addMaggotBatchInput(db, context, batch.batchId, input),
    allocated,
  );
  await assert.rejects(
    addMaggotBatchInput(db, context, batch.batchId, {
      idempotencyKey: key(),
      wasteId: waste.wasteId,
      quantity: "2.001",
    }),
    { code: "CONFLICT" },
  );
  await addMaggotObservation(db, context, batch.batchId, {
    idempotencyKey: key(),
    observedAt: "2026-10-01T08:00:00Z",
    observation: "Larva aktif dan ukuran bertambah.",
  });
  await assert.rejects(
    recordMaggotOutput(db, context, batch.batchId, {
      idempotencyKey: key(),
      harvestedAt: "2026-10-10T08:00:00Z",
      quantity: "1.5",
      unit: "UNIT",
    }),
    { code: "VALIDATION" },
  );
  const output = await recordMaggotOutput(db, context, batch.batchId, {
    idempotencyKey: key(),
    harvestedAt: "2026-10-10T08:00:00Z",
    quantity: "1.5",
    unit: "KG",
    notes: "Panen pertama",
  });
  await recordMaggotOutputUse(db, context, batch.batchId, output.outputId, {
    idempotencyKey: key(),
    quantity: "0.4",
    purpose: "Pakan ikan kolam A1",
  });
  await assert.rejects(
    recordMaggotOutputUse(db, context, batch.batchId, output.outputId, {
      idempotencyKey: key(),
      quantity: "1.2",
      purpose: "Pakan ikan kolam A1",
    }),
    { code: "CONFLICT" },
  );

  const detail = await getMaggotBatch(db, f.actorId, f.farmId, batch.batchId);
  assert.equal(detail.status, "OPEN");
  assert.equal(detail.inputs[0]?.remainingQuantity, "2.000");
  assert.equal(
    detail.observations[0]?.observation,
    "Larva aktif dan ukuran bertambah.",
  );
  assert.equal(detail.outputs[0]?.usedQuantity, "0.400");
  assert.equal(detail.outputs[0]?.remainingQuantity, "1.100");
  assert.equal(detail.outputs[0]?.unit, "KG");
  await completeMaggotBatch(db, context, batch.batchId, {
    idempotencyKey: key(),
    expectedStatus: "OPEN",
    completionNote: "Panen berjalan normal.",
  });
  await assert.rejects(
    recordMaggotOutput(db, context, batch.batchId, {
      idempotencyKey: key(),
      harvestedAt: "2026-10-11T08:00:00Z",
      quantity: "1",
      unit: "KG",
    }),
    { code: "CONFLICT" },
  );
  const after = await sql.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM inventory_movement WHERE farm_id=$1",
    [f.farmId],
  );
  assert.equal(after.rows[0]?.count, before.rows[0]?.count);
});

test("maggot input is tenant-scoped and batch reads require farm membership", async () => {
  const f = await fixture(sql);
  const other = await fixture(sql);
  const context = { farmId: f.farmId, actorId: f.actorId };
  const foreignWaste = await createWasteRecord(
    db,
    { farmId: other.farmId, actorId: other.actorId },
    {
      idempotencyKey: key(),
      source: "Sisa dedak",
      quantity: "4",
      unit: "KG",
      wasteDate: "2026-09-30",
    },
  );
  const batch = await createMaggotBatch(db, context, {
    idempotencyKey: key(),
    startedOn: "2026-09-30",
    media: "Dedak",
  });
  await assert.rejects(
    addMaggotBatchInput(db, context, batch.batchId, {
      idempotencyKey: key(),
      wasteId: randomUUID(),
      quantity: "1",
    }),
    { code: "NOT_FOUND" },
  );
  await assert.rejects(
    addMaggotBatchInput(db, context, batch.batchId, {
      idempotencyKey: key(),
      wasteId: foreignWaste.wasteId,
      quantity: "1",
    }),
    { code: "NOT_FOUND" },
  );
  await assert.rejects(
    getMaggotBatch(db, other.actorId, f.farmId, batch.batchId),
    { code: "FORBIDDEN" },
  );
});

test("maggot HTTP routes expose farm-scoped batch list and creation", async () => {
  const f = await fixture(sql);
  const server = createApp(db, async () => ({ userId: f.actorId })).listen(
    0,
    "127.0.0.1",
  );
  try {
    if (!server.listening)
      await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/farms/${f.farmId}/maggot/batches`;
    const created = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: key(),
        startedOn: "2026-09-30",
        media: "Dedak",
      }),
    });
    assert.equal(created.status, 200);
    const list = await fetch(base);
    assert.equal(list.status, 200);
    assert.equal(((await list.json()) as { data: unknown[] }).data.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

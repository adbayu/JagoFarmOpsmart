import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "../src/server/db.js";
import { createApp } from "../src/server/app.js";
import { listCircularFeedLots } from "../src/modules/circular/queries.js";
import { postMaggotOutputToFeed } from "../src/modules/circular/service.js";
import {
  addMaggotBatchInput,
  completeMaggotBatch,
  createMaggotBatch,
  recordMaggotOutput,
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

async function sourceOutput(farmId: string, actorId: string) {
  const context = { farmId, actorId };
  const waste = await createWasteRecord(db, context, {
    idempotencyKey: key(),
    source: "Sisa sayur",
    quantity: "5",
    unit: "KG",
    wasteDate: "2026-09-30",
  });
  const batch = await createMaggotBatch(db, context, {
    idempotencyKey: key(),
    startedOn: "2026-09-30",
    media: "Dedak",
  });
  await addMaggotBatchInput(db, context, batch.batchId, {
    idempotencyKey: key(),
    wasteId: waste.wasteId,
    quantity: "2",
  });
  const output = await recordMaggotOutput(db, context, batch.batchId, {
    idempotencyKey: key(),
    harvestedAt: "2026-10-15T08:00:00Z",
    quantity: "2",
    unit: "KG",
  });
  await completeMaggotBatch(db, context, batch.batchId, {
    idempotencyKey: key(),
    expectedStatus: "OPEN",
    completionNote: "Panen selesai.",
  });
  return { context, batchId: batch.batchId, outputId: output.outputId };
}

async function feedLot(
  farmId: string,
  actorId: string,
  { category = "FEED", unit = "KG", name = "Pakan" } = {},
) {
  const itemId = randomUUID();
  const lotId = randomUUID();
  await sql.query(
    `INSERT INTO inventory_item(id,farm_id,name,category,unit)
     VALUES($1,$2,$3,$4,$5)`,
    [itemId, farmId, name, category, unit],
  );
  await sql.query(
    `INSERT INTO inventory_lot(id,farm_id,inventory_item_id,label,location)
     VALUES($1,$2,$3,'Lot maggot','Rak pakan')`,
    [lotId, farmId, itemId],
  );
  return { itemId, lotId, actorId };
}

test("maggot output posting creates one same-unit feed movement and preserves provenance", async () => {
  const f = await fixture(sql);
  const source = await sourceOutput(f.farmId, f.actorId);
  const destination = await feedLot(f.farmId, f.actorId);
  const options = await listCircularFeedLots(db, f.actorId, f.farmId);
  assert.equal(options.length, 1);
  assert.equal(options[0]?.unit, "KG");
  const input = {
    idempotencyKey: key(),
    batchId: source.batchId,
    outputId: source.outputId,
    lotId: destination.lotId,
    quantity: "1.5",
    reason: "Pakan dari batch maggot M-01",
  };
  const posted = await postMaggotOutputToFeed(db, source.context, input);
  assert.deepEqual(
    await postMaggotOutputToFeed(db, source.context, input),
    posted,
  );
  const movement = await sql.query<{
    type: string;
    quantity_delta: string;
    unit: string;
    reason: string;
  }>(
    `SELECT type,quantity_delta::text,unit,reason FROM inventory_movement
     WHERE farm_id=$1 AND id=$2`,
    [f.farmId, posted.movementId],
  );
  assert.deepEqual(movement.rows[0], {
    type: "STOCK_IN",
    quantity_delta: "1.500",
    unit: "KG",
    reason: "Pakan dari batch maggot M-01",
  });
  const balance = await sql.query<{ quantity: string }>(
    `SELECT COALESCE(sum(quantity_delta),0)::text AS quantity
     FROM inventory_movement WHERE farm_id=$1 AND lot_id=$2`,
    [f.farmId, destination.lotId],
  );
  assert.equal(balance.rows[0]?.quantity, "1.500");
  const detail = await getMaggotBatch(db, f.actorId, f.farmId, source.batchId);
  assert.equal(detail.outputs[0]?.postedQuantity, "1.500");
  assert.equal(detail.outputs[0]?.remainingQuantity, "0.500");
  assert.equal(detail.outputs[0]?.postings[0]?.lotId, destination.lotId);
});

test("circular posting rejects open batches, cross-unit lots, and excess quantities", async () => {
  const f = await fixture(sql);
  const source = await sourceOutput(f.farmId, f.actorId);
  const destination = await feedLot(f.farmId, f.actorId);
  await sql.query(
    "UPDATE maggot_batch SET status='OPEN',completed_at=NULL,completed_by=NULL,completion_note=NULL WHERE farm_id=$1 AND id=$2",
    [f.farmId, source.batchId],
  );
  await assert.rejects(
    postMaggotOutputToFeed(db, source.context, {
      idempotencyKey: key(),
      batchId: source.batchId,
      outputId: source.outputId,
      lotId: destination.lotId,
      quantity: "1",
      reason: "Pakan",
    }),
    { code: "CONFLICT" },
  );
  await completeMaggotBatch(db, source.context, source.batchId, {
    idempotencyKey: key(),
    expectedStatus: "OPEN",
    completionNote: "Panen selesai.",
  });
  const nutrientLot = await feedLot(f.farmId, f.actorId, {
    category: "NUTRIENT",
    name: "Nutrisi tanaman",
  });
  await assert.rejects(
    postMaggotOutputToFeed(db, source.context, {
      idempotencyKey: key(),
      batchId: source.batchId,
      outputId: source.outputId,
      lotId: nutrientLot.lotId,
      quantity: "1",
      reason: "Pakan",
    }),
    { code: "CONFLICT" },
  );
  const gramLot = await feedLot(f.farmId, f.actorId, {
    unit: "G",
    name: "Pakan gram",
  });
  await assert.rejects(
    postMaggotOutputToFeed(db, source.context, {
      idempotencyKey: key(),
      batchId: source.batchId,
      outputId: source.outputId,
      lotId: gramLot.lotId,
      quantity: "1",
      reason: "Pakan",
    }),
    { code: "CONFLICT" },
  );
  await postMaggotOutputToFeed(db, source.context, {
    idempotencyKey: key(),
    batchId: source.batchId,
    outputId: source.outputId,
    lotId: destination.lotId,
    quantity: "1.5",
    reason: "Pakan",
  });
  await assert.rejects(
    postMaggotOutputToFeed(db, source.context, {
      idempotencyKey: key(),
      batchId: source.batchId,
      outputId: source.outputId,
      lotId: destination.lotId,
      quantity: "0.6",
      reason: "Pakan",
    }),
    { code: "CONFLICT" },
  );
});

test("circular feed options and postings do not cross farm boundaries", async () => {
  const f = await fixture(sql);
  const other = await fixture(sql);
  const source = await sourceOutput(f.farmId, f.actorId);
  const foreignLot = await feedLot(other.farmId, other.actorId);
  await assert.rejects(listCircularFeedLots(db, other.actorId, f.farmId), {
    code: "FORBIDDEN",
  });
  await assert.rejects(
    postMaggotOutputToFeed(db, source.context, {
      idempotencyKey: key(),
      batchId: source.batchId,
      outputId: source.outputId,
      lotId: foreignLot.lotId,
      quantity: "1",
      reason: "Pakan",
    }),
    { code: "NOT_FOUND" },
  );
});

test("circular feed lot and maggot posting routes use the authorized farm", async () => {
  const f = await fixture(sql);
  const source = await sourceOutput(f.farmId, f.actorId);
  const destination = await feedLot(f.farmId, f.actorId);
  const server = createApp(db, async () => ({ userId: f.actorId })).listen(
    0,
    "127.0.0.1",
  );
  try {
    if (!server.listening)
      await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/farms/${f.farmId}/circular`;
    const lots = await fetch(`${base}/feed-lots`);
    assert.equal(lots.status, 200);
    const post = await fetch(`${base}/maggot-postings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: key(),
        batchId: source.batchId,
        outputId: source.outputId,
        lotId: destination.lotId,
        quantity: "1",
        reason: "Pakan",
      }),
    });
    assert.equal(post.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

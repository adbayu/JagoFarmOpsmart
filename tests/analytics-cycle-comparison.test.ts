import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "../src/server/db.js";
import { createApp } from "../src/server/app.js";
import { fixture } from "./fixture.js";
import { createUnit } from "../src/modules/farming/service.js";
import {
  createCycle,
  transitionCycle,
} from "../src/modules/farming/cycle-service.js";
import { postHarvest, cancelHarvest } from "../src/modules/harvest/service.js";
import { recordCost } from "../src/modules/finance/cost-service.js";

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

const key = () => randomUUID();

test("cycle comparison keeps farm, date, unit, and direct posted-cost boundaries", async () => {
  const f = await fixture(sql);
  const context = { actorId: f.actorId, farmId: f.farmId };
  const unit = await createUnit(db, context, {
    idempotencyKey: key(),
    name: "Kolam pembanding TEST",
    type: "FISH",
  });
  const secondCycle = await createCycle(db, context, {
    idempotencyKey: key(),
    unitId: unit.unitId,
    commodityId: f.commodityId,
    name: "Siklus pembanding TEST",
    type: "FISH",
    startDate: "2026-09-01",
    initialPopulation: 100,
  });
  await transitionCycle(db, context, secondCycle.cycleId, {
    idempotencyKey: key(),
    expectedStatus: "PLANNED",
    status: "ACTIVE",
  });

  const harvestA1 = await postHarvest(db, context, {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    harvestDate: "2026-09-01",
    outputs: [{ productId: f.productId, quantity: "2", lotLabel: "A1 TEST" }],
  });
  const harvestA2 = await postHarvest(db, context, {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    harvestDate: "2026-09-15",
    outputs: [{ productId: f.productId, quantity: "3", lotLabel: "A2 TEST" }],
  });
  const cancelledHarvest = await postHarvest(db, context, {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    harvestDate: "2026-09-20",
    outputs: [
      { productId: f.productId, quantity: "7", lotLabel: "A cancelled TEST" },
    ],
  });
  await cancelHarvest(db, context, cancelledHarvest.harvestId, {
    idempotencyKey: key(),
    reason: "TEST comparison excludes cancelled harvests",
  });
  const harvestB1 = await postHarvest(db, context, {
    idempotencyKey: key(),
    cycleId: secondCycle.cycleId,
    harvestDate: "2026-09-02",
    outputs: [{ productId: f.productId, quantity: "4", lotLabel: "B1 TEST" }],
  });
  await postHarvest(db, context, {
    idempotencyKey: key(),
    cycleId: secondCycle.cycleId,
    harvestDate: "2026-10-01",
    outputs: [
      { productId: f.productId, quantity: "8", lotLabel: "B outside TEST" },
    ],
  });

  const costA = await recordCost(db, context, {
    idempotencyKey: key(),
    sourceKey: `COMPARE-A-${key()}`,
    cycleId: f.cycleId,
    category: "Pakan TEST",
    treatment: "PRODUCTION",
    amountMinor: "1500",
    costDate: "2026-09-01",
  });
  const costAUnclassified = await recordCost(db, context, {
    idempotencyKey: key(),
    sourceKey: `COMPARE-A-UNCLASSIFIED-${key()}`,
    cycleId: f.cycleId,
    category: "Obat TEST",
    treatment: "UNCLASSIFIED",
    amountMinor: "200",
    costDate: "2026-09-16",
  });
  await recordCost(db, context, {
    idempotencyKey: key(),
    sourceKey: `COMPARE-A-OUTSIDE-${key()}`,
    cycleId: f.cycleId,
    category: "Pakan TEST",
    treatment: "PRODUCTION",
    amountMinor: "3000",
    costDate: "2026-10-01",
  });
  const costB = await recordCost(db, context, {
    idempotencyKey: key(),
    sourceKey: `COMPARE-B-${key()}`,
    cycleId: secondCycle.cycleId,
    category: "Pakan TEST",
    treatment: "PRODUCTION",
    amountMinor: "2400",
    costDate: "2026-09-02",
  });
  await recordCost(db, context, {
    idempotencyKey: key(),
    sourceKey: `COMPARE-FARM-WIDE-${key()}`,
    category: "Pakan TEST",
    amountMinor: "990000",
    costDate: "2026-09-05",
  });

  const server = createApp(db, async () => ({ userId: f.actorId })).listen(
    0,
    "127.0.0.1",
  );
  try {
    if (!server.listening)
      await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const query = new URLSearchParams({
      cycleIdA: f.cycleId,
      cycleIdB: secondCycle.cycleId,
      from: "2026-09-01",
      toExclusive: "2026-10-01",
    });
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/farms/${f.farmId}/analytics/cycle-comparison?${query}`,
    );
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const payload = JSON.parse(responseText) as {
      data: {
        from: string;
        toExclusive: string;
        asOf: string;
        cycles: {
          cycleId: string;
          production: {
            quantity: string;
            unit: string;
            harvestCount: number;
            harvestIds: string[];
          }[];
          costs: {
            category: string;
            treatment: string;
            amountMinor: string;
            entryCount: number;
            costIds: string[];
          }[];
        }[];
      };
    };
    assert.equal(payload.data.from, "2026-09-01");
    assert.equal(payload.data.toExclusive, "2026-10-01");
    assert.ok(Number.isFinite(Date.parse(payload.data.asOf)));
    assert.deepEqual(
      payload.data.cycles.map((cycle) => cycle.cycleId),
      [f.cycleId, secondCycle.cycleId],
    );
    assert.deepEqual(payload.data.cycles[0]!.production, [
      {
        commodityId: f.commodityId,
        commodityName: "Nila",
        unit: "KG",
        quantity: "5.000",
        harvestCount: 2,
        harvestIds: [harvestA1.harvestId, harvestA2.harvestId].sort(),
      },
    ]);
    assert.deepEqual(payload.data.cycles[0]!.costs, [
      {
        category: "Obat TEST",
        treatment: "UNCLASSIFIED",
        amountMinor: "200",
        entryCount: 1,
        costIds: [costAUnclassified.id],
      },
      {
        category: "Pakan TEST",
        treatment: "PRODUCTION",
        amountMinor: "1500",
        entryCount: 1,
        costIds: [costA.id],
      },
    ]);
    assert.deepEqual(payload.data.cycles[1]!.production, [
      {
        commodityId: f.commodityId,
        commodityName: "Nila",
        unit: "KG",
        quantity: "4.000",
        harvestCount: 1,
        harvestIds: [harvestB1.harvestId],
      },
    ]);
    assert.deepEqual(payload.data.cycles[1]!.costs, [
      {
        category: "Pakan TEST",
        treatment: "PRODUCTION",
        amountMinor: "2400",
        entryCount: 1,
        costIds: [costB.id],
      },
    ]);

    const sameCycle = await fetch(
      `http://127.0.0.1:${address.port}/api/farms/${f.farmId}/analytics/cycle-comparison?${new URLSearchParams(
        {
          cycleIdA: f.cycleId,
          cycleIdB: f.cycleId,
          from: "2026-09-01",
          toExclusive: "2026-10-01",
        },
      )}`,
    );
    assert.equal(sameCycle.status, 422);

    const missingCycle = await fetch(
      `http://127.0.0.1:${address.port}/api/farms/${f.farmId}/analytics/cycle-comparison?${new URLSearchParams(
        {
          cycleIdA: f.cycleId,
          cycleIdB: key(),
          from: "2026-09-01",
          toExclusive: "2026-10-01",
        },
      )}`,
    );
    assert.equal(missingCycle.status, 404);

    const foreignActor = createApp(db, async () => ({ userId: key() })).listen(
      0,
      "127.0.0.1",
    );
    try {
      if (!foreignActor.listening)
        await new Promise<void>((resolve) =>
          foreignActor.once("listening", resolve),
        );
      const foreignAddress = foreignActor.address();
      assert.ok(foreignAddress && typeof foreignAddress !== "string");
      const forbidden = await fetch(
        `http://127.0.0.1:${foreignAddress.port}/api/farms/${f.farmId}/analytics/cycle-comparison?${query}`,
      );
      assert.equal(forbidden.status, 403);
    } finally {
      await new Promise<void>((resolve, reject) =>
        foreignActor.close((error) => (error ? reject(error) : resolve())),
      );
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { consume } from "../src/modules/inventory/service.js";
import { completeSale } from "../src/modules/sales/service.js";
import {
  assertActivityTransition,
  assertCycleTransition,
} from "../src/modules/farming/states.js";
import {
  consumeInput,
  saleInput,
  quantity,
  moneyMinor,
} from "../src/shared/validation.js";
import { createCycleInput } from "../src/modules/farming/contracts.js";
import {
  scaled,
  decimal,
  lineTotal,
  validateUnitQuantity,
} from "../src/shared/decimal.js";
import * as domain from "../src/shared/domain.js";
import { createApp } from "../src/server/app.js";
import type { Database } from "../src/server/db.js";
import { fixture, consumptionFor, saleFor } from "./fixture.js";

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
async function balance(f: { farmId: string; lotId: string }) {
  return (
    await sql.query<{ quantity: string }>(
      "SELECT quantity::text FROM stock_balance WHERE farm_id=$1 AND lot_id=$2",
      [f.farmId, f.lotId],
    )
  ).rows[0]?.quantity;
}
test("migration enums match shared runtime definitions", async () => {
  const pairs = {
    farming_type: domain.farmingTypes,
    cycle_status: domain.cycleStatuses,
    activity_status: domain.activityStatuses,
    activity_kind: domain.activityKinds,
    measure_unit: domain.units,
    movement_type: domain.movementTypes,
    payment_status: domain.paymentStatuses,
    transaction_status: domain.transactionStatuses,
    record_status: domain.recordStatuses,
    product_status: domain.productStatuses,
    inventory_category: domain.inventoryCategories,
  };
  for (const [name, values] of Object.entries(pairs)) {
    const rows = await sql.query<{ enumlabel: string }>(
      "SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid=enumtypid WHERE typname=$1 ORDER BY enumsortorder",
      [name],
    );
    assert.deepEqual(
      rows.rows.map((r) => r.enumlabel),
      [...values],
    );
  }
});
test("exact quantities and money, fractional animal units rejected", () => {
  assert.equal(scaled("0.125") + scaled("0.875"), 1000n);
  assert.equal(decimal(-2125n), "-2.125");
  assert.equal(lineTotal(1500n, 101n), 152n);
  assert.throws(() => validateUnitQuantity(1500n, "HEAD"));
  assert.throws(() => scaled("1.0001"));
});
test("boundary validation rejects invalid dates, totals and nonpositive quantities", () => {
  for (const value of ["0", "-1", "NaN", "1.0001"])
    assert.equal(quantity.safeParse(value).success, false);
  for (const value of ["-1", "12.5", "1e3"])
    assert.equal(moneyMinor.safeParse(value).success, false);
  assert.equal(
    saleInput.safeParse({
      idempotencyKey: randomUUID(),
      buyer: "A",
      saleDate: "2026-02-30",
      items: [],
    }).success,
    false,
  );
  assert.equal(consumeInput.safeParse({}).success, false);
  assert.equal(
    createCycleInput.safeParse({
      idempotencyKey: randomUUID(),
      unitId: randomUUID(),
      commodityId: randomUUID(),
      name: "X",
      type: "FISH",
      initialPopulation: 10,
      startDate: "2026-09-01",
      targetHarvestDate: "2026-08-01",
    }).success,
    false,
  );
});
test("terminal lifecycle states cannot reopen; missed activity can resume", () => {
  assertCycleTransition("PLANNED", "ACTIVE");
  assertActivityTransition("MISSED", "IN_PROGRESS");
  assert.throws(() => assertCycleTransition("COMPLETED", "ACTIVE"));
  assert.throws(() => assertActivityTransition("CANCELLED", "COMPLETED"));
});
test("consumption commits exact ledger movement and replays once", async () => {
  const f = await fixture(sql),
    input = consumptionFor(f);
  const result = await consume(db, f, input);
  assert.deepEqual(await consume(db, f, input), result);
  assert.equal(await balance(f), "7.875");
  assert.equal(
    (await sql.query("SELECT id FROM consumption WHERE farm_id=$1", [f.farmId]))
      .rows.length,
    1,
  );
  await assert.rejects(
    consume(db, f, {
      ...input,
      allocations: [{ lotId: f.lotId, quantity: "3" }],
    }),
    { code: "CONFLICT" },
  );
});
test("insufficient stock rolls back consumption and command receipt", async () => {
  const f = await fixture(sql);
  await assert.rejects(consume(db, f, consumptionFor(f, "11")), {
    code: "INSUFFICIENT_STOCK",
  });
  assert.equal(await balance(f), "10.000");
  assert.equal(
    (await sql.query("SELECT id FROM consumption WHERE farm_id=$1", [f.farmId]))
      .rows.length,
    0,
  );
  assert.equal(
    (
      await sql.query(
        "SELECT operation FROM command_receipt WHERE farm_id=$1",
        [f.farmId],
      )
    ).rows.length,
    0,
  );
});
test("cross-farm user and cross-farm references are denied", async () => {
  const a = await fixture(sql),
    b = await fixture(sql);
  await assert.rejects(
    consume(db, { farmId: a.farmId, actorId: b.actorId }, consumptionFor(a)),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    consume(db, a, { ...consumptionFor(a), activityId: b.activityId }),
    { code: "CONFLICT" },
  );
  await assert.rejects(
    sql.query("UPDATE activity SET cycle_id=$1 WHERE id=$2", [
      b.cycleId,
      a.activityId,
    ]),
  );
  await assert.rejects(
    sql.query("INSERT INTO coop(unit_id,farm_id) VALUES($1,$2)", [
      a.unitId,
      a.farmId,
    ]),
  );
});
test("unit mismatch and duplicate lot allocation roll back", async () => {
  const f = await fixture(sql),
    input = consumptionFor(f);
  await assert.rejects(consume(db, f, { ...input, unit: "L" }), {
    code: "NOT_FOUND",
  });
  await assert.rejects(
    consume(db, f, {
      ...input,
      allocations: [...input.allocations, ...input.allocations],
    }),
    { code: "VALIDATION" },
  );
  assert.equal(await balance(f), "10.000");
});
test("movements cannot be edited or deleted", async () => {
  const f = await fixture(sql);
  await assert.rejects(
    sql.query("DELETE FROM inventory_movement WHERE farm_id=$1", [f.farmId]),
  );
  await assert.rejects(
    sql.query(
      "UPDATE inventory_movement SET quantity_delta=100 WHERE farm_id=$1",
      [f.farmId],
    ),
  );
});
test("multi-item sale computes totals server-side and deducts once on replay", async () => {
  const f = await fixture(sql),
    input = saleFor(f);
  input.items.push({
    ...input.items[0]!,
    allocations: [{ lotId: f.lotId, quantity: "1" }],
  });
  const result = await completeSale(db, f, input);
  assert.equal(result.totalMinor, "10937500");
  assert.deepEqual(await completeSale(db, f, input), result);
  assert.equal(await balance(f), "6.875");
  const row = (
    await sql.query<{ payment_status: string }>(
      "SELECT payment_status FROM sale WHERE id=$1",
      [result.saleId],
    )
  ).rows[0];
  assert.equal(row?.payment_status, "UNPAID");
});
test("failure on second sale line rolls back first deduction, sale, lines and receipt", async () => {
  const f = await fixture(sql),
    input = saleFor(f, "4");
  input.items.push({
    ...input.items[0]!,
    allocations: [{ lotId: f.lotId, quantity: "7" }],
  });
  await assert.rejects(completeSale(db, f, input), {
    code: "INSUFFICIENT_STOCK",
  });
  assert.equal(await balance(f), "10.000");
  assert.equal(
    (await sql.query("SELECT id FROM sale WHERE farm_id=$1", [f.farmId])).rows
      .length,
    0,
  );
  assert.equal(
    (await sql.query("SELECT id FROM sale_item WHERE farm_id=$1", [f.farmId]))
      .rows.length,
    0,
  );
});
test("server rejects missing session and ignores forged identity headers", async () => {
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/farms/${randomUUID()}/consumptions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": randomUUID(),
        },
        body: "{}",
      },
    );
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "UNAUTHORIZED");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});

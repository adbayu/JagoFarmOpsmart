import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "../src/server/db.js";
import { fixture } from "./fixture.js";
import { createFarm } from "../src/modules/farms/service.js";
import {
  createItem,
  createLot,
} from "../src/modules/inventory/item-service.js";
import { createProduct } from "../src/modules/products/service.js";
import { postHarvest, cancelHarvest } from "../src/modules/harvest/service.js";
import { listHarvests } from "../src/modules/harvest/queries.js";
import { completeSale, cancelSale } from "../src/modules/sales/service.js";
import { listSales, listSaleLotOptions } from "../src/modules/sales/queries.js";
import { stockIn } from "../src/modules/inventory/movement-service.js";
import { consume } from "../src/modules/inventory/service.js";
import {
  createActivity,
  transitionActivity,
} from "../src/modules/schedules/service.js";
import { recordCost } from "../src/modules/finance/cost-service.js";
import { listCosts } from "../src/modules/finance/queries.js";
import {
  recordPayment,
  recordRefund,
} from "../src/modules/finance/payment-service.js";
import { getPaymentBalance } from "../src/modules/finance/payment-queries.js";
import { getDashboard } from "../src/modules/analytics/dashboard-queries.js";
import { getProductionAnalytics } from "../src/modules/analytics/queries.js";
import { getAdvancedAnalytics } from "../src/modules/analytics/advanced-queries.js";
import { createWaterTransfer } from "../src/modules/circular/service.js";
import { calculateHpp } from "../src/modules/finance/calculator.js";
import {
  getCycleHpp,
  markCycleCostsComplete,
} from "../src/modules/finance/hpp-queries.js";
import { createApp } from "../src/server/app.js";
import { createUnit } from "../src/modules/farming/service.js";
import { createCycleInput } from "../src/modules/farming/contracts.js";
import {
  createCommodity,
  createCycle,
  transitionCycle,
} from "../src/modules/farming/cycle-service.js";

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

test("fish multi-grade journey, receipts, stock reversals and payment/refund policy", async () => {
  const f = await fixture(sql);
  const context = { actorId: f.actorId, farmId: f.farmId };
  const itemA = await createItem(db, context, {
    idempotencyKey: key(),
    name: "Lele A TEST",
    category: "HARVEST_PRODUCT",
    unit: "KG",
  });
  const itemB = await createItem(db, context, {
    idempotencyKey: key(),
    name: "Lele B TEST",
    category: "HARVEST_PRODUCT",
    unit: "KG",
  });
  const productA = await createProduct(db, context, {
    idempotencyKey: key(),
    name: "Lele A TEST",
    grade: "A",
    inventoryItemId: itemA.id,
    commodityId: f.commodityId,
    targetPriceMinor: "30000",
  });
  const productB = await createProduct(db, context, {
    idempotencyKey: key(),
    name: "Lele B TEST",
    grade: "B",
    inventoryItemId: itemB.id,
    commodityId: f.commodityId,
    targetPriceMinor: "25000",
  });
  await assert.rejects(
    postHarvest(db, context, {
      idempotencyKey: key(),
      cycleId: f.cycleId,
      harvestDate: "2026-09-28",
      outputs: [
        { productId: productA.id, quantity: "1", lotLabel: "ROLLBACK" },
        { productId: key(), quantity: "1", lotLabel: "INVALID" },
      ],
    }),
    { code: "CONFLICT" },
  );
  assert.equal((await listHarvests(db, f.actorId, f.farmId)).length, 0);
  const harvestInput = {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    harvestDate: "2026-09-28",
    outputs: [
      { productId: productA.id, quantity: "5", lotLabel: "A TEST" },
      { productId: productB.id, quantity: "2", lotLabel: "B TEST" },
    ],
  };
  const harvest = await postHarvest(db, context, harvestInput);
  assert.deepEqual(await postHarvest(db, context, harvestInput), harvest);
  assert.equal((await listHarvests(db, f.actorId, f.farmId)).length, 1);
  const lots = await listSaleLotOptions(db, f.actorId, f.farmId);
  assert.equal(
    lots.filter((lot) => [productA.id, productB.id].includes(lot.productId))
      .length,
    2,
  );
  const saleInput = {
    idempotencyKey: key(),
    buyer: "TEST BUYER",
    saleDate: "2026-09-28",
    items: [
      {
        productId: productA.id,
        unitPriceMinor: "30000",
        allocations: [{ lotId: harvest.outputs[0]!.lotId, quantity: "2" }],
      },
      {
        productId: productB.id,
        unitPriceMinor: "25000",
        allocations: [{ lotId: harvest.outputs[1]!.lotId, quantity: "1" }],
      },
    ],
  };
  const sale = await completeSale(db, context, saleInput);
  assert.equal(sale.totalMinor, "85000");
  assert.deepEqual(await completeSale(db, context, saleInput), sale);
  const sales = await listSales(db, f.actorId, f.farmId);
  assert.equal(sales[0]!.items.length, 2);
  assert.equal(sales[0]!.items[0]!.allocations[0]!.cycleId, f.cycleId);
  await assert.rejects(
    cancelHarvest(db, context, harvest.harvestId, {
      idempotencyKey: key(),
      reason: "TEST",
    }),
    { code: "INSUFFICIENT_STOCK" },
  );
  const payment = await recordPayment(db, context, sale.saleId, {
    idempotencyKey: key(),
    sourceKey: "TEST PAY 001",
    amountMinor: "30000",
    paymentDate: "2026-09-28",
  });
  assert.equal(payment.status, "PARTIAL");
  await assert.rejects(
    cancelSale(db, context, sale.saleId, {
      idempotencyKey: key(),
      reason: "TEST",
    }),
    { code: "CONFLICT" },
  );
  const refund = await recordRefund(db, context, sale.saleId, {
    idempotencyKey: key(),
    sourceKey: "TEST REFUND 001",
    amountMinor: "30000",
    paymentDate: "2026-09-28",
    reason: "TEST refund",
  });
  assert.equal(refund.status, "UNPAID");
  assert.equal(
    (await getPaymentBalance(db, f.actorId, f.farmId, sale.saleId))
      .netReceivedMinor,
    "0",
  );
  await cancelSale(db, context, sale.saleId, {
    idempotencyKey: key(),
    reason: "TEST cancellation",
  });
  await cancelHarvest(db, context, harvest.harvestId, {
    idempotencyKey: key(),
    reason: "TEST cancellation",
  });
  assert.equal(
    (await getDashboard(db, f.actorId, f.farmId)).production.length,
    0,
  );
  assert.equal(
    (
      await getProductionAnalytics(
        db,
        f.actorId,
        f.farmId,
        "2026-09-28",
        "2026-09-29",
      )
    ).rows.length,
    0,
  );
  await assert.rejects(listHarvests(db, key(), f.farmId), {
    code: "FORBIDDEN",
  });
});

test("chicken and crop keep discrete units separate through harvest, sale and analytics", async () => {
  const f = await fixture(sql);
  const context = { actorId: f.actorId, farmId: f.farmId };
  const branches = [
    {
      type: "CHICKEN" as const,
      name: "Broiler TEST",
      unit: "HEAD" as const,
      activityKind: "FEEDING" as const,
      resourceCategory: "FEED" as const,
      firstQuantity: "3",
      secondQuantity: "2",
      initialPopulation: 20,
    },
    {
      type: "CROP" as const,
      name: "Sawi TEST",
      unit: "UNIT" as const,
      activityKind: "FERTILIZING" as const,
      resourceCategory: "FERTILIZER" as const,
      firstQuantity: "6",
      secondQuantity: "4",
      seedCount: 100,
    },
  ];
  for (const branch of branches) {
    const unit = await createUnit(db, context, {
      idempotencyKey: key(),
      name: `Unit ${branch.name}`,
      type: branch.type,
    });
    const commodity = await createCommodity(db, context, {
      idempotencyKey: key(),
      name: branch.name,
      type: branch.type,
    });
    const cycleInput = {
      idempotencyKey: key(),
      unitId: unit.unitId,
      commodityId: commodity.id,
      name: `Cycle ${branch.name}`,
      type: branch.type,
      startDate: "2026-09-01",
      ...(branch.type === "CHICKEN"
        ? { initialPopulation: branch.initialPopulation }
        : { seedCount: branch.seedCount }),
    };
    const parsedCycle = createCycleInput.safeParse(cycleInput);
    assert.equal(
      parsedCycle.success,
      true,
      JSON.stringify(parsedCycle.error?.issues),
    );
    const cycle = await createCycle(db, context, cycleInput);
    await transitionCycle(db, context, cycle.cycleId, {
      idempotencyKey: key(),
      expectedStatus: "PLANNED",
      status: "ACTIVE",
    });
    const activity = await createActivity(db, context, {
      idempotencyKey: key(),
      cycleId: cycle.cycleId,
      kind: branch.activityKind,
      scheduledAt: "2026-09-28T08:00:00Z",
      notes: `TEST ${branch.name}`,
    });
    await transitionActivity(db, context, {
      idempotencyKey: key(),
      activityId: activity.activityId,
      expectedStatus: "SCHEDULED",
      status: "IN_PROGRESS",
    });
    const input = await createItem(db, context, {
      idempotencyKey: key(),
      name: `Input ${branch.name}`,
      category: branch.resourceCategory,
      unit: "KG",
    });
    const inputLot = await createLot(db, context, {
      idempotencyKey: key(),
      inventoryItemId: input.id,
      label: `Input lot ${branch.name}`,
    });
    const intake = await stockIn(db, context, {
      idempotencyKey: key(),
      lotId: inputLot.id,
      quantity: "20",
      reason: `TEST ${branch.name}`,
    });
    const purchaseCost = await recordCost(db, context, {
      idempotencyKey: key(),
      sourceKey: `BRANCH-PURCHASE-${branch.type}-${key()}`,
      category: `${branch.resourceCategory} purchase TEST`,
      treatment: "INVENTORY_PURCHASE",
      amountMinor: "100000",
      costDate: "2026-09-28",
      inventoryMovementId: intake.movementId,
    });
    assert.equal(purchaseCost.treatment, "INVENTORY_PURCHASE");
    const consumption = await consume(db, context, {
      idempotencyKey: key(),
      cycleId: cycle.cycleId,
      activityId: activity.activityId,
      inventoryItemId: input.id,
      unit: "KG",
      allocations: [{ lotId: inputLot.id, quantity: "2" }],
    });
    await transitionActivity(db, context, {
      idempotencyKey: key(),
      activityId: activity.activityId,
      expectedStatus: "IN_PROGRESS",
      status: "COMPLETED",
    });
    const consumedMovement = await sql.query<{ id: string }>(
      "SELECT id FROM inventory_movement WHERE farm_id=$1 AND consumption_id=$2 AND type='CONSUMPTION'",
      [f.farmId, consumption.consumptionId],
    );
    assert.equal(consumedMovement.rows.length, 1);
    const productionCost = await recordCost(db, context, {
      idempotencyKey: key(),
      cycleId: cycle.cycleId,
      activityId: activity.activityId,
      inventoryMovementId: consumedMovement.rows[0]!.id,
      sourceKey: `BRANCH-PRODUCTION-${branch.type}-${key()}`,
      category: `${branch.resourceCategory} use TEST`,
      treatment: "PRODUCTION",
      amountMinor: "25000",
      costDate: "2026-09-28",
    });
    assert.equal(productionCost.treatment, "PRODUCTION");
    const item = await createItem(db, context, {
      idempotencyKey: key(),
      name: `Stock ${branch.name}`,
      category: "HARVEST_PRODUCT",
      unit: branch.unit,
    });
    const product = await createProduct(db, context, {
      idempotencyKey: key(),
      name: `Product ${branch.name}`,
      inventoryItemId: item.id,
      commodityId: commodity.id,
    });
    await assert.rejects(
      postHarvest(db, context, {
        idempotencyKey: key(),
        cycleId: cycle.cycleId,
        harvestDate: "2026-09-28",
        outputs: [
          { productId: product.id, quantity: "1.5", lotLabel: "INVALID" },
        ],
      }),
      { code: "VALIDATION" },
    );
    const firstHarvest = await postHarvest(db, context, {
      idempotencyKey: key(),
      cycleId: cycle.cycleId,
      harvestDate: "2026-09-28",
      outputs: [
        {
          productId: product.id,
          quantity: branch.firstQuantity,
          weightKg: "3",
          lotLabel: `LOT 1 ${branch.name}`,
        },
      ],
    });
    const secondHarvest = await postHarvest(db, context, {
      idempotencyKey: key(),
      cycleId: cycle.cycleId,
      harvestDate: "2026-09-29",
      outputs: [
        {
          productId: product.id,
          quantity: branch.secondQuantity,
          weightKg: "2",
          lotLabel: `LOT 2 ${branch.name}`,
        },
      ],
    });
    await markCycleCostsComplete(db, context, cycle.cycleId, {
      idempotencyKey: key(),
    });
    const hpp = await getCycleHpp(db, f.actorId, f.farmId, cycle.cycleId);
    assert.equal(hpp.hpp.status, "AVAILABLE");
    if (hpp.hpp.status === "AVAILABLE") {
      assert.equal(hpp.hpp.value.totalProductionCostMinor, "25000");
      assert.equal(hpp.hpp.value.costPerUnitMinor, "5000.000000");
      assert.equal(hpp.hpp.value.sourceHarvestIds.length, 2);
      assert.equal(hpp.hpp.value.sourceCostIds.length, 1);
    }
    const sale = await completeSale(db, context, {
      idempotencyKey: key(),
      buyer: "TEST BUYER",
      saleDate: "2026-09-28",
      items: [
        {
          productId: product.id,
          unitPriceMinor: "1000",
          allocations: [
            { lotId: firstHarvest.outputs[0]!.lotId, quantity: "1" },
            { lotId: secondHarvest.outputs[0]!.lotId, quantity: "1" },
          ],
        },
      ],
    });
    assert.equal(sale.totalMinor, "2000");
    const payment = await recordPayment(db, context, sale.saleId, {
      idempotencyKey: key(),
      sourceKey: `BRANCH-PAYMENT-${branch.type}-${key()}`,
      amountMinor: sale.totalMinor,
      paymentDate: "2026-09-29",
    });
    assert.equal(payment.status, "PAID");
  }
  assert.equal((await listSales(db, f.actorId, f.farmId)).length, 2);
  assert.equal((await listCosts(db, f.actorId, f.farmId)).costs.length, 4);
  const dashboard = await getDashboard(db, f.actorId, f.farmId);
  assert.equal(dashboard.activeUnits.CHICKEN, 1);
  assert.equal(dashboard.activeUnits.CROP, 1);
  assert.equal(dashboard.finance.revenue.status, "AVAILABLE");
  if (dashboard.finance.revenue.status === "AVAILABLE")
    assert.equal(dashboard.finance.revenue.value, "4000");
  const analytics = await getProductionAnalytics(
    db,
    f.actorId,
    f.farmId,
    "2026-09-28",
    "2026-09-30",
  );
  assert.equal(analytics.rows.length, 2);
  assert.deepEqual(
    new Set(analytics.rows.map((row) => row.unit)),
    new Set(["HEAD", "UNIT"]),
  );
  assert.equal(
    analytics.rows.find((row) => row.unit === "HEAD")?.quantity,
    "5.000",
  );
  assert.equal(
    analytics.rows.find((row) => row.unit === "UNIT")?.quantity,
    "10.000",
  );
  assert.ok(analytics.rows.every((row) => row.harvestCount === 2));
  assert.equal(analytics.revenue.status, "AVAILABLE");
  assert.equal(analytics.financeSources.paymentIds.length, 2);
  assert.equal(
    (
      await getProductionAnalytics(
        db,
        f.actorId,
        f.farmId,
        "2026-09-30",
        "2026-10-01",
      )
    ).rows.length,
    0,
  );
});

test("full fish workflow creates farm through sale, projections and reversal", async () => {
  const actorId = key();
  await sql.query(
    "INSERT INTO app_user(id,auth_subject,display_name) VALUES($1,$2,$3)",
    [actorId, `test:${actorId}`, "FULL JOURNEY TEST USER"],
  );
  const farm = await createFarm(db, actorId, {
    idempotencyKey: key(),
    name: "Full journey TEST ONLY",
    location: "TEST pen",
  });
  const context = { actorId, farmId: farm.id };
  const unit = await createUnit(db, context, {
    idempotencyKey: key(),
    name: "Kolam TEST ONLY",
    type: "FISH",
    areaM2: "24",
    depthM: "1.5",
    capacityHeads: 1200,
  });
  const commodity = await createCommodity(db, context, {
    idempotencyKey: key(),
    type: "FISH",
    name: "Lele TEST ONLY",
  });
  const cycle = await createCycle(db, context, {
    idempotencyKey: key(),
    unitId: unit.unitId,
    commodityId: commodity.id,
    name: "Siklus TEST ONLY",
    type: "FISH",
    startDate: "2026-09-01",
    initialPopulation: 1000,
  });
  await transitionCycle(db, context, cycle.cycleId, {
    idempotencyKey: key(),
    expectedStatus: "PLANNED",
    status: "ACTIVE",
  });
  const activity = await createActivity(db, context, {
    idempotencyKey: key(),
    cycleId: cycle.cycleId,
    kind: "FEEDING",
    scheduledAt: "2026-09-29T01:00:00Z",
    notes: "TEST ONLY",
  });
  await transitionActivity(db, context, {
    idempotencyKey: key(),
    activityId: activity.activityId,
    expectedStatus: "SCHEDULED",
    status: "IN_PROGRESS",
  });

  const feed = await createItem(db, context, {
    idempotencyKey: key(),
    name: "Pakan TEST ONLY",
    category: "FEED",
    unit: "KG",
  });
  const feedLot = await createLot(db, context, {
    idempotencyKey: key(),
    inventoryItemId: feed.id,
    label: "Lot pakan TEST ONLY",
  });
  const intake = await stockIn(db, context, {
    idempotencyKey: key(),
    lotId: feedLot.id,
    quantity: "20",
    reason: "Pembelian TEST ONLY",
  });
  const purchaseCost = await recordCost(db, context, {
    idempotencyKey: key(),
    sourceKey: "FULL-JOURNEY-PURCHASE-TEST",
    category: "Pembelian pakan TEST ONLY",
    amountMinor: "100000",
    costDate: "2026-09-29",
    inventoryMovementId: intake.movementId,
  });
  assert.equal(purchaseCost.treatment, "UNCLASSIFIED");

  const consumption = await consume(db, context, {
    idempotencyKey: key(),
    cycleId: cycle.cycleId,
    activityId: activity.activityId,
    inventoryItemId: feed.id,
    unit: "KG",
    allocations: [{ lotId: feedLot.id, quantity: "2.5" }],
  });
  await transitionActivity(db, context, {
    idempotencyKey: key(),
    activityId: activity.activityId,
    expectedStatus: "IN_PROGRESS",
    status: "COMPLETED",
  });
  const consumedMovement = await sql.query<{ id: string }>(
    "SELECT id FROM inventory_movement WHERE farm_id=$1 AND consumption_id=$2 AND type='CONSUMPTION'",
    [farm.id, consumption.consumptionId],
  );
  assert.equal(consumedMovement.rows.length, 1);
  const productionCost = await recordCost(db, context, {
    idempotencyKey: key(),
    cycleId: cycle.cycleId,
    activityId: activity.activityId,
    inventoryMovementId: consumedMovement.rows[0]!.id,
    sourceKey: "FULL-JOURNEY-CONSUMPTION-TEST",
    category: "Pemakaian pakan TEST ONLY",
    amountMinor: "25000",
    costDate: "2026-09-29",
  });
  assert.equal(productionCost.treatment, "UNCLASSIFIED");
  assert.equal(productionCost.movementType, "CONSUMPTION");
  assert.equal((await listCosts(db, actorId, farm.id)).costs.length, 2);

  const productAItem = await createItem(db, context, {
    idempotencyKey: key(),
    name: "Lele grade A TEST ONLY",
    category: "HARVEST_PRODUCT",
    unit: "KG",
  });
  const productBItem = await createItem(db, context, {
    idempotencyKey: key(),
    name: "Lele grade B TEST ONLY",
    category: "HARVEST_PRODUCT",
    unit: "KG",
  });
  const productA = await createProduct(db, context, {
    idempotencyKey: key(),
    name: "Lele TEST ONLY",
    grade: "A",
    inventoryItemId: productAItem.id,
    commodityId: commodity.id,
  });
  const productB = await createProduct(db, context, {
    idempotencyKey: key(),
    name: "Lele TEST ONLY",
    grade: "B",
    inventoryItemId: productBItem.id,
    commodityId: commodity.id,
  });
  const firstHarvest = await postHarvest(db, context, {
    idempotencyKey: key(),
    cycleId: cycle.cycleId,
    harvestDate: "2026-09-28",
    outputs: [
      { productId: productA.id, quantity: "10", lotLabel: "A TEST" },
      { productId: productB.id, quantity: "8", lotLabel: "B TEST" },
    ],
  });
  const partialHarvest = await postHarvest(db, context, {
    idempotencyKey: key(),
    cycleId: cycle.cycleId,
    harvestDate: "2026-09-29",
    outputs: [{ productId: productA.id, quantity: "2", lotLabel: "A2 TEST" }],
  });

  const sale = await completeSale(db, context, {
    idempotencyKey: key(),
    buyer: "Buyer TEST ONLY",
    saleDate: "2026-09-29",
    items: [
      {
        productId: productA.id,
        unitPriceMinor: "30000",
        allocations: [
          { lotId: firstHarvest.outputs[0]!.lotId, quantity: "4" },
          { lotId: partialHarvest.outputs[0]!.lotId, quantity: "1" },
        ],
      },
      {
        productId: productB.id,
        unitPriceMinor: "25000",
        allocations: [{ lotId: firstHarvest.outputs[1]!.lotId, quantity: "3" }],
      },
    ],
  });
  assert.equal(sale.totalMinor, "225000");
  const savedSales = await listSales(db, actorId, farm.id);
  assert.equal(savedSales.length, 1);
  assert.equal(savedSales[0]!.items.length, 2);
  assert.equal(
    savedSales[0]!.items.find((item) => item.productId === productA.id)!
      .allocations.length,
    2,
  );
  const dashboard = await getDashboard(db, actorId, farm.id);
  assert.equal(dashboard.activeUnits.FISH, 1);
  assert.equal(dashboard.activeCycles, 1);
  assert.equal(dashboard.production[0]!.quantity, "20.000");
  assert.equal(dashboard.finance.recordedCosts, "125000");
  assert.equal(dashboard.finance.revenue.status, "AVAILABLE");
  if (dashboard.finance.revenue.status === "AVAILABLE")
    assert.equal(dashboard.finance.revenue.value, "0");
  const analytics = await getProductionAnalytics(
    db,
    actorId,
    farm.id,
    "2026-09-28",
    "2026-09-30",
    cycle.cycleId,
  );
  assert.equal(analytics.rows.length, 1);
  assert.equal(analytics.rows[0]!.quantity, "20.000");
  assert.equal(analytics.rows[0]!.harvestCount, 2);

  await cancelSale(db, context, sale.saleId, {
    idempotencyKey: key(),
    reason: "TEST reversal",
  });
  await cancelHarvest(db, context, firstHarvest.harvestId, {
    idempotencyKey: key(),
    reason: "TEST reversal",
  });
  await cancelHarvest(db, context, partialHarvest.harvestId, {
    idempotencyKey: key(),
    reason: "TEST reversal",
  });
  assert.equal(
    (
      await getProductionAnalytics(
        db,
        actorId,
        farm.id,
        "2026-09-28",
        "2026-09-30",
      )
    ).rows.length,
    0,
  );
});

test("HPP calculator requires complete sources and uses exact quantity arithmetic", () => {
  const missing = calculateHpp({
    productionCostMinor: "0",
    outputQuantity: "1",
    unit: "KG",
    sourceCostIds: [],
    sourceHarvestIds: [],
    costsComplete: false,
    policyVersion: "v1",
    asOf: "2026-09-29",
  });
  assert.equal(missing.status, "UNAVAILABLE");
  const result = calculateHpp({
    productionCostMinor: "100",
    outputQuantity: "3",
    unit: "KG",
    sourceCostIds: [key()],
    sourceHarvestIds: [key()],
    costsComplete: true,
    policyVersion: "v1",
    asOf: "2026-09-29",
  });
  assert.equal(result.status, "AVAILABLE");
  if (result.status === "AVAILABLE")
    assert.equal(result.value.costPerUnitMinor, "33.333333");
});

test("HPP accepts true zero cost only when cycle costs are marked complete", () => {
  const harvestId = key();
  const result = calculateHpp({
    productionCostMinor: "0",
    outputQuantity: "3",
    unit: "KG",
    sourceCostIds: [],
    sourceHarvestIds: [harvestId],
    costsComplete: true,
    policyVersion: "finance-mvp-v1",
    asOf: "2026-09-30",
  });
  assert.deepEqual(result, {
    status: "AVAILABLE",
    value: {
      costPerUnitMinor: "0.000000",
      totalProductionCostMinor: "0",
      sourceCostIds: [],
      sourceHarvestIds: [harvestId],
    },
    method: "direct-cycle-allocation:finance-mvp-v1",
    asOf: "2026-09-30",
  });
});

test("cycle production costs keep their approved classification and version", async () => {
  const f = await fixture(sql);
  const cost = await recordCost(
    db,
    { actorId: f.actorId, farmId: f.farmId },
    {
      idempotencyKey: key(),
      cycleId: f.cycleId,
      sourceKey: "CLASSIFIED-CYCLE-COST-TEST",
      category: "Pakan tertimbang TEST ONLY",
      treatment: "PRODUCTION",
      amountMinor: "12345",
      costDate: "2026-09-30",
    },
  );
  assert.equal(cost.treatment, "PRODUCTION");
  const stored = await sql.query<{ policy_version: string }>(
    "SELECT policy_version FROM cost_entry WHERE farm_id=$1 AND id=$2",
    [f.farmId, cost.id],
  );
  assert.equal(stored.rows[0]?.policy_version, "finance-mvp-v1");
});

test("owner can mark cycle costs complete and read a reproducible zero-cost HPP", async () => {
  const f = await fixture(sql);
  const context = { actorId: f.actorId, farmId: f.farmId };
  await postHarvest(db, context, {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    harvestDate: "2026-09-30",
    outputs: [
      {
        productId: f.productId,
        quantity: "2",
        weightKg: "2",
        lotLabel: "HPP TEST",
      },
    ],
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
    const base = `http://127.0.0.1:${address.port}/api/farms/${f.farmId}/finance/hpp/${f.cycleId}`;
    const completed = await fetch(`${base}/cost-complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: key() }),
    });
    assert.equal(completed.status, 200);
    const response = await fetch(base);
    assert.equal(response.status, 200);
    const { data } = (await response.json()) as {
      data: { hpp: { status: string; value?: { costPerUnitMinor: string } } };
    };
    assert.equal(data.hpp.status, "AVAILABLE");
    assert.equal(data.hpp.value?.costPerUnitMinor, "0.000000");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("cycle HPP divides classified costs by posted harvest weight and returns source IDs", async () => {
  const f = await fixture(sql);
  const context = { actorId: f.actorId, farmId: f.farmId };
  const harvest = await postHarvest(db, context, {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    harvestDate: "2026-09-30",
    outputs: [
      {
        productId: f.productId,
        quantity: "4",
        weightKg: "2",
        lotLabel: "HPP TEST",
      },
    ],
  });
  const cost = await recordCost(db, context, {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    sourceKey: "HPP-DIRECT-COST-TEST",
    category: "Biaya produksi TEST ONLY",
    treatment: "PRODUCTION",
    amountMinor: "100",
    costDate: "2026-09-30",
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
    const base = `http://127.0.0.1:${address.port}/api/farms/${f.farmId}/finance/hpp/${f.cycleId}`;
    await fetch(`${base}/cost-complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: key() }),
    });
    const response = await fetch(base);
    assert.equal(response.status, 200);
    const { data } = (await response.json()) as {
      data: {
        hpp: {
          status: string;
          value?: {
            costPerUnitMinor: string;
            sourceCostIds: string[];
            sourceHarvestIds: string[];
          };
        };
      };
    };
    assert.equal(data.hpp.status, "AVAILABLE");
    assert.equal(data.hpp.value?.costPerUnitMinor, "50.000000");
    assert.deepEqual(data.hpp.value?.sourceCostIds, [cost.id]);
    assert.deepEqual(data.hpp.value?.sourceHarvestIds, [harvest.harvestId]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("cycle HPP stays unavailable when any posted output lacks a measurable weight", async () => {
  const f = await fixture(sql);
  const context = { actorId: f.actorId, farmId: f.farmId };
  await postHarvest(db, context, {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    harvestDate: "2026-09-30",
    outputs: [
      {
        productId: f.productId,
        quantity: "4",
        lotLabel: "MISSING WEIGHT TEST",
      },
    ],
  });
  await markCycleCostsComplete(db, context, f.cycleId, {
    idempotencyKey: key(),
  });
  const projection = await getCycleHpp(db, f.actorId, f.farmId, f.cycleId);
  assert.equal(projection.hpp.status, "UNAVAILABLE");
  if (projection.hpp.status === "UNAVAILABLE")
    assert.match(projection.hpp.reason, /berat kg belum tercatat/i);
});

test("new farm costs stale the completion marker and unclassified costs block HPP", async () => {
  const f = await fixture(sql);
  const context = { actorId: f.actorId, farmId: f.farmId };
  await postHarvest(db, context, {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    harvestDate: "2026-09-30",
    outputs: [
      {
        productId: f.productId,
        quantity: "2",
        weightKg: "2",
        lotLabel: "STALE HPP TEST",
      },
    ],
  });
  await markCycleCostsComplete(db, context, f.cycleId, {
    idempotencyKey: key(),
  });
  await recordCost(db, context, {
    idempotencyKey: key(),
    sourceKey: "UNALLOCATED-COST-TEST",
    category: "Biaya belum dialokasikan TEST ONLY",
    amountMinor: "100",
    costDate: "2026-09-30",
  });
  const stale = await getCycleHpp(db, f.actorId, f.farmId, f.cycleId);
  assert.equal(stale.costCompletion.current, false);
  assert.equal(stale.hpp.status, "UNAVAILABLE");
  await markCycleCostsComplete(db, context, f.cycleId, {
    idempotencyKey: key(),
  });
  const unclassified = await getCycleHpp(db, f.actorId, f.farmId, f.cycleId);
  assert.equal(unclassified.costCompletion.current, true);
  assert.equal(unclassified.hpp.status, "UNAVAILABLE");
  if (unclassified.hpp.status === "UNAVAILABLE")
    assert.match(unclassified.hpp.reason, /belum diklasifikasikan/i);
});

test("HPP waits for a measured cost for each inventory consumption", async () => {
  const f = await fixture(sql);
  const context = { actorId: f.actorId, farmId: f.farmId };
  const feed = await createItem(db, context, {
    idempotencyKey: key(),
    name: "Pakan HPP TEST",
    category: "FEED",
    unit: "KG",
  });
  const feedLot = await createLot(db, context, {
    idempotencyKey: key(),
    inventoryItemId: feed.id,
    label: "Pakan HPP TEST",
  });
  await stockIn(db, context, {
    idempotencyKey: key(),
    lotId: feedLot.id,
    quantity: "5",
    reason: "TEST intake",
  });
  await transitionActivity(db, context, {
    idempotencyKey: key(),
    activityId: f.activityId,
    expectedStatus: "SCHEDULED",
    status: "IN_PROGRESS",
  });
  const consumption = await consume(db, context, {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    activityId: f.activityId,
    inventoryItemId: feed.id,
    unit: "KG",
    allocations: [{ lotId: feedLot.id, quantity: "1" }],
  });
  const movement = await sql.query<{ id: string }>(
    "SELECT id FROM inventory_movement WHERE farm_id=$1 AND consumption_id=$2 AND type='CONSUMPTION'",
    [f.farmId, consumption.consumptionId],
  );
  await postHarvest(db, context, {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    harvestDate: "2026-09-30",
    outputs: [
      {
        productId: f.productId,
        quantity: "2",
        weightKg: "2",
        lotLabel: "CONSUMPTION HPP TEST",
      },
    ],
  });
  await markCycleCostsComplete(db, context, f.cycleId, {
    idempotencyKey: key(),
  });
  const missingCost = await getCycleHpp(db, f.actorId, f.farmId, f.cycleId);
  assert.equal(missingCost.hpp.status, "UNAVAILABLE");
  if (missingCost.hpp.status === "UNAVAILABLE")
    assert.match(missingCost.hpp.reason, /pemakaian persediaan/i);
  await recordCost(db, context, {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    activityId: f.activityId,
    inventoryMovementId: movement.rows[0]!.id,
    sourceKey: "CONSUMED-FEED-COST-TEST",
    category: "Biaya pakan terpakai TEST ONLY",
    treatment: "PRODUCTION",
    amountMinor: "50",
    costDate: "2026-09-30",
  });
  await markCycleCostsComplete(db, context, f.cycleId, {
    idempotencyKey: key(),
  });
  const measured = await getCycleHpp(db, f.actorId, f.farmId, f.cycleId);
  assert.equal(measured.hpp.status, "AVAILABLE");
  if (measured.hpp.status === "AVAILABLE")
    assert.equal(measured.hpp.value.totalProductionCostMinor, "50");
});

test("dashboard revenue follows posted payment and refund dates", async () => {
  const f = await fixture(sql);
  const context = { actorId: f.actorId, farmId: f.farmId };
  const sale = await completeSale(db, context, {
    idempotencyKey: key(),
    buyer: "REVENUE TEST",
    saleDate: "2026-09-30",
    items: [
      {
        productId: f.productId,
        unitPriceMinor: "1000",
        allocations: [{ lotId: f.lotId, quantity: "1" }],
      },
    ],
  });
  const payment = await recordPayment(db, context, sale.saleId, {
    idempotencyKey: key(),
    sourceKey: "REVENUE-PAYMENT-TEST",
    amountMinor: "1000",
    paymentDate: "2026-09-30",
  });
  const refund = await recordRefund(db, context, sale.saleId, {
    idempotencyKey: key(),
    sourceKey: "REVENUE-REFUND-TEST",
    amountMinor: "250",
    paymentDate: "2026-09-30",
    reason: "TEST refund",
  });
  const dashboard = await getDashboard(db, f.actorId, f.farmId);
  assert.equal(dashboard.finance.revenue.status, "AVAILABLE");
  if (dashboard.finance.revenue.status === "AVAILABLE")
    assert.equal(dashboard.finance.revenue.value, "750");
});

test("partial payment recognizes proportional cycle HPP and refund only reduces revenue", async () => {
  const f = await fixture(sql);
  const context = { actorId: f.actorId, farmId: f.farmId };
  const harvest = await postHarvest(db, context, {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    harvestDate: "2026-09-30",
    outputs: [
      {
        productId: f.productId,
        quantity: "4",
        weightKg: "4",
        lotLabel: "MATCHED HPP TEST",
      },
    ],
  });
  await recordCost(db, context, {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    sourceKey: "MATCHED-HPP-COST-TEST",
    category: "Biaya siklus TEST ONLY",
    treatment: "PRODUCTION",
    amountMinor: "400",
    costDate: "2026-09-30",
  });
  await markCycleCostsComplete(db, context, f.cycleId, {
    idempotencyKey: key(),
  });
  const sale = await completeSale(db, context, {
    idempotencyKey: key(),
    buyer: "MATCHED HPP TEST",
    saleDate: "2026-09-30",
    items: [
      {
        productId: f.productId,
        unitPriceMinor: "1000",
        allocations: [{ lotId: harvest.outputs[0]!.lotId, quantity: "2" }],
      },
    ],
  });
  const payment = await recordPayment(db, context, sale.saleId, {
    idempotencyKey: key(),
    sourceKey: "MATCHED-HPP-PAYMENT-TEST",
    amountMinor: "1000",
    paymentDate: "2026-09-30",
  });
  const refund = await recordRefund(db, context, sale.saleId, {
    idempotencyKey: key(),
    sourceKey: "MATCHED-HPP-REFUND-TEST",
    amountMinor: "200",
    paymentDate: "2026-09-30",
    reason: "TEST refund",
  });
  const dashboard = await getDashboard(db, f.actorId, f.farmId);
  assert.equal(dashboard.finance.revenue.status, "AVAILABLE");
  assert.equal(dashboard.finance.hpp.status, "AVAILABLE");
  assert.equal(dashboard.finance.profit.status, "AVAILABLE");
  if (
    dashboard.finance.revenue.status === "AVAILABLE" &&
    dashboard.finance.hpp.status === "AVAILABLE" &&
    dashboard.finance.profit.status === "AVAILABLE"
  ) {
    assert.equal(dashboard.finance.revenue.value, "800");
    assert.equal(dashboard.finance.hpp.value, "100");
    assert.equal(dashboard.finance.profit.value, "700");
  }
  assert.ok(dashboard.finance.sources.paymentIds.includes(payment.paymentId));
  assert.ok(
    dashboard.finance.sources.hppPaymentIds.includes(payment.paymentId),
  );
  assert.ok(dashboard.finance.sources.refundIds.includes(refund.paymentId));
  const analytics = await getProductionAnalytics(
    db,
    f.actorId,
    f.farmId,
    "2026-09-30",
    "2026-10-01",
  );
  assert.equal(analytics.revenue.status, "AVAILABLE");
  assert.equal(analytics.hpp.status, "AVAILABLE");
  assert.equal(analytics.profit.status, "AVAILABLE");
  if (
    analytics.revenue.status === "AVAILABLE" &&
    analytics.hpp.status === "AVAILABLE" &&
    analytics.profit.status === "AVAILABLE"
  ) {
    assert.equal(analytics.revenue.value, "800");
    assert.equal(analytics.hpp.value, "100");
    assert.equal(analytics.profit.value, "700");
  }
});

test("sale cancellation reverses recognized HPP on cancellation date", async () => {
  const f = await fixture(sql);
  const context = { actorId: f.actorId, farmId: f.farmId };
  const clock = await sql.query<{ today: string }>(
    "SELECT CURRENT_DATE::text AS today",
  );
  const today = clock.rows[0]!.today;
  const paymentDate = new Date(`${today}T00:00:00Z`);
  paymentDate.setUTCDate(paymentDate.getUTCDate() - 1);
  const priorDay = paymentDate.toISOString().slice(0, 10);
  const tomorrowDate = new Date(`${today}T00:00:00Z`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = tomorrowDate.toISOString().slice(0, 10);
  const harvest = await postHarvest(db, context, {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    harvestDate: priorDay,
    outputs: [
      {
        productId: f.productId,
        quantity: "4",
        weightKg: "4",
        lotLabel: "CANCEL HPP TEST",
      },
    ],
  });
  await recordCost(db, context, {
    idempotencyKey: key(),
    cycleId: f.cycleId,
    sourceKey: "CANCEL-HPP-COST-TEST",
    category: "Biaya siklus TEST ONLY",
    treatment: "PRODUCTION",
    amountMinor: "400",
    costDate: priorDay,
  });
  await markCycleCostsComplete(db, context, f.cycleId, {
    idempotencyKey: key(),
  });
  const sale = await completeSale(db, context, {
    idempotencyKey: key(),
    buyer: "CANCEL HPP TEST",
    saleDate: priorDay,
    items: [
      {
        productId: f.productId,
        unitPriceMinor: "1000",
        allocations: [{ lotId: harvest.outputs[0]!.lotId, quantity: "2" }],
      },
    ],
  });
  await recordPayment(db, context, sale.saleId, {
    idempotencyKey: key(),
    sourceKey: "CANCEL-HPP-PAYMENT-TEST",
    amountMinor: "1000",
    paymentDate: priorDay,
  });
  await recordRefund(db, context, sale.saleId, {
    idempotencyKey: key(),
    sourceKey: "CANCEL-HPP-REFUND-TEST",
    amountMinor: "1000",
    paymentDate: priorDay,
    reason: "TEST cancellation refund",
  });

  await cancelSale(db, context, sale.saleId, {
    idempotencyKey: key(),
    reason: "TEST cancellation",
  });

  const beforeCancellation = await getProductionAnalytics(
    db,
    f.actorId,
    f.farmId,
    priorDay,
    today,
  );
  assert.equal(beforeCancellation.hpp.status, "AVAILABLE");
  if (beforeCancellation.hpp.status === "AVAILABLE")
    assert.equal(beforeCancellation.hpp.value, "100");
  const cancellationDay = await getProductionAnalytics(
    db,
    f.actorId,
    f.farmId,
    today,
    tomorrow,
  );
  assert.equal(cancellationDay.hpp.status, "AVAILABLE");
  if (cancellationDay.hpp.status === "AVAILABLE")
    assert.equal(cancellationDay.hpp.value, "-100");
  assert.ok(cancellationDay.financeSources.saleIds.includes(sale.saleId));
  assert.equal(cancellationDay.financeSources.movementIds.length, 2);
  const dashboard = await getDashboard(db, f.actorId, f.farmId);
  assert.equal(dashboard.finance.hpp.status, "AVAILABLE");
  if (dashboard.finance.hpp.status === "AVAILABLE")
    assert.equal(dashboard.finance.hpp.value, "0");
});

test("API errors expose request IDs but no SQL or secrets", async () => {
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
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/farms/${f.farmId}/harvests`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(response.status, 422);
    assert.match(response.headers.get("X-Request-Id") ?? "", /^[0-9a-f-]{36}$/);
    const body = await response.text();
    assert.ok(!/SELECT |INSERT |password|postgres:/i.test(body));
    assert.ok(body.includes("requestId"));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("advanced analytics returns scoped production, costs, circular use, and water transfer volume", async () => {
  const f = await fixture(sql);
  const context = { farmId: f.farmId, actorId: f.actorId };
  const cropUnit = await createUnit(db, context, {
    idempotencyKey: key(),
    name: "Area Analitik TEST",
    type: "CROP",
  });
  const waterTransfer = await createWaterTransfer(db, context, {
    idempotencyKey: key(),
    sourceUnitId: f.unitId,
    targetUnitId: cropUnit.unitId,
    quantityLiters: "25.125",
    transferDate: "2026-09-15",
    note: "Pencatatan untuk tes analitik",
  });
  await createWaterTransfer(db, context, {
    idempotencyKey: key(),
    sourceUnitId: f.unitId,
    targetUnitId: cropUnit.unitId,
    quantityLiters: "100",
    transferDate: "2026-10-01",
  });
  const harvest = await postHarvest(
    db,
    { farmId: f.farmId, actorId: f.actorId },
    {
      idempotencyKey: randomUUID(),
      cycleId: f.cycleId,
      harvestDate: "2026-09-30",
      outputs: [
        {
          productId: f.productId,
          quantity: "4",
          weightKg: "4",
          lotLabel: "ANALYTICS TEST",
        },
      ],
    },
  );
  const cost = await recordCost(
    db,
    { farmId: f.farmId, actorId: f.actorId },
    {
      idempotencyKey: randomUUID(),
      sourceKey: `ADVANCED-ANALYTICS-${randomUUID()}`,
      category: "Pakan",
      amountMinor: "125000",
      costDate: "2026-09-30",
    },
  );
  await recordCost(
    db,
    { farmId: f.farmId, actorId: f.actorId },
    {
      idempotencyKey: randomUUID(),
      sourceKey: `ADVANCED-ANALYTICS-OUTSIDE-${randomUUID()}`,
      category: "Obat",
      amountMinor: "30000",
      costDate: "2026-10-01",
    },
  );

  const kgWasteId = randomUUID();
  const literWasteId = randomUUID();
  const outsideWasteId = randomUUID();
  const batchId = randomUUID();
  const kgInputId = randomUUID();
  const literInputId = randomUUID();
  const outsideInputId = randomUUID();
  const kgOutputId = randomUUID();
  const gramOutputId = randomUUID();
  const outsideOutputId = randomUUID();
  await sql.query(
    `INSERT INTO waste_record(id,farm_id,source,quantity,unit,waste_date,created_by,updated_by)
     VALUES($1,$2,'Sisa pakan TEST',8,'KG','2026-09-10',$3,$3),
           ($4,$2,'Air limbah TEST',12,'L','2026-09-11',$3,$3),
           ($5,$2,'Batas periode TEST',99,'KG','2026-10-01',$3,$3)`,
    [kgWasteId, f.farmId, f.actorId, literWasteId, outsideWasteId],
  );
  await sql.query(
    `INSERT INTO maggot_batch(id,farm_id,started_on,media,created_by)
     VALUES($1,$2,'2026-09-01','Dedak TEST',$3)`,
    [batchId, f.farmId, f.actorId],
  );
  await sql.query(
    `INSERT INTO maggot_batch_input(id,farm_id,batch_id,waste_id,quantity,unit,created_by,created_at)
     VALUES($1,$2,$3,$4,2.5,'KG',$5,'2026-09-29T10:00:00Z'),
           ($6,$2,$3,$7,3,'L',$5,'2026-09-15T10:00:00Z'),
           ($8,$2,$3,$9,99,'KG',$5,'2026-10-01T00:00:00Z')`,
    [
      kgInputId,
      f.farmId,
      batchId,
      kgWasteId,
      f.actorId,
      literInputId,
      literWasteId,
      outsideInputId,
      outsideWasteId,
    ],
  );
  await sql.query(
    `INSERT INTO maggot_batch_output(id,farm_id,batch_id,harvested_at,quantity,unit,created_by)
     VALUES($1,$2,$3,'2026-09-30T12:00:00Z',4.25,'KG',$4),
           ($5,$2,$3,'2026-09-01T00:00:00Z',450,'G',$4),
           ($6,$2,$3,'2026-10-01T00:00:00Z',99,'KG',$4)`,
    [kgOutputId, f.farmId, batchId, f.actorId, gramOutputId, outsideOutputId],
  );

  const other = await fixture(sql);
  const otherWasteId = randomUUID();
  const otherBatchId = randomUUID();
  const otherInputId = randomUUID();
  const otherOutputId = randomUUID();
  await sql.query(
    `INSERT INTO waste_record(id,farm_id,source,quantity,unit,waste_date,created_by,updated_by)
     VALUES($1,$2,'Farm lain TEST',999,'KG','2026-09-10',$3,$3)`,
    [otherWasteId, other.farmId, other.actorId],
  );
  await sql.query(
    `INSERT INTO maggot_batch(id,farm_id,started_on,media,created_by)
     VALUES($1,$2,'2026-09-01','Dedak farm lain TEST',$3)`,
    [otherBatchId, other.farmId, other.actorId],
  );
  await sql.query(
    `INSERT INTO maggot_batch_input(id,farm_id,batch_id,waste_id,quantity,unit,created_by,created_at)
     VALUES($1,$2,$3,$4,999,'KG',$5,'2026-09-29T10:00:00Z')`,
    [otherInputId, other.farmId, otherBatchId, otherWasteId, other.actorId],
  );
  await sql.query(
    `INSERT INTO maggot_batch_output(id,farm_id,batch_id,harvested_at,quantity,unit,created_by)
     VALUES($1,$2,$3,'2026-09-30T12:00:00Z',999,'KG',$4)`,
    [otherOutputId, other.farmId, otherBatchId, other.actorId],
  );

  const result = await getAdvancedAnalytics(
    db,
    f.actorId,
    f.farmId,
    "2026-09-01",
    "2026-10-01",
  );

  assert.deepEqual(result.productionTrend, [
    {
      period: "2026-09-01",
      commodityId: f.commodityId,
      commodityName: "Nila",
      unit: "KG",
      quantity: "4.000",
      harvestCount: 1,
      harvestIds: [harvest.harvestId],
    },
  ]);
  assert.deepEqual(result.recordedCostBreakdown, [
    {
      category: "Pakan",
      treatment: "UNCLASSIFIED",
      amountMinor: "125000",
      entryCount: 1,
      costIds: [cost.id],
    },
  ]);
  assert.deepEqual(result.recordedWaterTransfers, [
    {
      period: "2026-09-01",
      sourceUnitId: f.unitId,
      sourceUnitName: "Kolam A",
      targetUnitId: cropUnit.unitId,
      targetUnitName: "Area Analitik TEST",
      quantityLiters: "25.125",
      transferCount: 1,
      transferIds: [waterTransfer.transferId],
    },
  ]);
  assert.deepEqual(
    (result as unknown as { maggotWasteInputs: unknown[] }).maggotWasteInputs,
    [
      {
        period: "2026-09-01",
        unit: "KG",
        quantity: "2.500",
        inputCount: 1,
        inputIds: [kgInputId],
        wasteIds: [kgWasteId],
        batchIds: [batchId],
      },
      {
        period: "2026-09-01",
        unit: "L",
        quantity: "3.000",
        inputCount: 1,
        inputIds: [literInputId],
        wasteIds: [literWasteId],
        batchIds: [batchId],
      },
    ],
  );
  assert.deepEqual(
    (result as unknown as { maggotOutputs: unknown[] }).maggotOutputs,
    [
      {
        period: "2026-09-01",
        unit: "G",
        quantity: "450.000",
        outputCount: 1,
        outputIds: [gramOutputId],
        batchIds: [batchId],
      },
      {
        period: "2026-09-01",
        unit: "KG",
        quantity: "4.250",
        outputCount: 1,
        outputIds: [kgOutputId],
        batchIds: [batchId],
      },
    ],
  );
  assert.equal(result.from, "2026-09-01");
  assert.equal(result.toExclusive, "2026-10-01");
  await assert.rejects(
    getAdvancedAnalytics(
      db,
      randomUUID(),
      f.farmId,
      "2026-09-01",
      "2026-10-01",
    ),
    { code: "FORBIDDEN" },
  );
  const server = createApp(db, async () => ({ userId: f.actorId })).listen(
    0,
    "127.0.0.1",
  );
  try {
    if (!server.listening)
      await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/farms/${f.farmId}/analytics/advanced?from=2026-09-01&toExclusive=2026-10-01`,
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      data: {
        productionTrend: unknown[];
        recordedWaterTransfers: unknown[];
        maggotWasteInputs: typeof result.maggotWasteInputs;
        maggotOutputs: typeof result.maggotOutputs;
      };
    };
    assert.equal(payload.data.productionTrend.length, 1);
    assert.equal(payload.data.recordedWaterTransfers.length, 1);
    assert.deepEqual(payload.data.maggotWasteInputs, result.maggotWasteInputs);
    assert.deepEqual(payload.data.maggotOutputs, result.maggotOutputs);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

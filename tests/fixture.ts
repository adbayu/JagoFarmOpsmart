import { randomUUID } from "node:crypto";
import type { Sql } from "../src/server/db.js";
/** Development-only fixtures, never loaded by the application or production migrations. */
export async function fixture(sql: Sql) {
  const f = {
    actorId: randomUUID(),
    farmId: randomUUID(),
    unitId: randomUUID(),
    commodityId: randomUUID(),
    cycleId: randomUUID(),
    activityId: randomUUID(),
    itemId: randomUUID(),
    lotId: randomUUID(),
    productId: randomUUID(),
  };
  await sql.query(
    "INSERT INTO app_user(id,auth_subject,display_name) VALUES($1,$2,$3)",
    [f.actorId, `test:${f.actorId}`, "DEVELOPMENT TEST USER"],
  );
  await sql.query("INSERT INTO farm(id,owner_id,name) VALUES($1,$2,$3)", [
    f.farmId,
    f.actorId,
    "JagoFarm Demo — TEST ONLY",
  ]);
  await sql.query(
    "INSERT INTO farm_membership(farm_id,user_id,added_by) VALUES($1,$2,$2)",
    [f.farmId, f.actorId],
  );
  await sql.query(
    "INSERT INTO commodity(id,farm_id,name,farming_type) VALUES($1,$2,'Nila','FISH')",
    [f.commodityId, f.farmId],
  );
  await sql.query(
    "INSERT INTO farm_unit(id,farm_id,name,farming_type) VALUES($1,$2,'Kolam A','FISH')",
    [f.unitId, f.farmId],
  );
  await sql.query(
    "INSERT INTO pond(unit_id,farm_id,area_m2) VALUES($1,$2,20)",
    [f.unitId, f.farmId],
  );
  await sql.query(
    "INSERT INTO farming_cycle(id,farm_id,unit_id,commodity_id,farming_type,name,status,start_date,created_by) VALUES($1,$2,$3,$4,'FISH','Siklus Uji','ACTIVE','2026-09-01',$5)",
    [f.cycleId, f.farmId, f.unitId, f.commodityId, f.actorId],
  );
  await sql.query(
    "INSERT INTO fish_cycle(cycle_id,farm_id,initial_population) VALUES($1,$2,100)",
    [f.cycleId, f.farmId],
  );
  await sql.query(
    "INSERT INTO activity(id,farm_id,cycle_id,kind,scheduled_at,created_by) VALUES($1,$2,$3,'FEEDING','2026-09-28T08:00:00Z',$4)",
    [f.activityId, f.farmId, f.cycleId, f.actorId],
  );
  await sql.query(
    "INSERT INTO inventory_item(id,farm_id,name,category,unit) VALUES($1,$2,'Stok uji','HARVEST_PRODUCT','KG')",
    [f.itemId, f.farmId],
  );
  await sql.query(
    "INSERT INTO inventory_lot(id,farm_id,inventory_item_id,label) VALUES($1,$2,$3,'LOT TEST')",
    [f.lotId, f.farmId, f.itemId],
  );
  await sql.query(
    "INSERT INTO inventory_movement(id,farm_id,lot_id,inventory_item_id,type,quantity_delta,unit,reason,created_by) VALUES($1,$2,$3,$4,'STOCK_IN',10,'KG','TEST ONLY',$5)",
    [randomUUID(), f.farmId, f.lotId, f.itemId, f.actorId],
  );
  await sql.query(
    "INSERT INTO product(id,farm_id,commodity_id,inventory_item_id,name,unit) VALUES($1,$2,$3,$4,'Nila Uji','KG')",
    [f.productId, f.farmId, f.commodityId, f.itemId],
  );
  return f;
}
export function consumptionFor(
  f: Awaited<ReturnType<typeof fixture>>,
  quantity = "2.125",
) {
  return {
    idempotencyKey: randomUUID(),
    cycleId: f.cycleId,
    activityId: f.activityId,
    inventoryItemId: f.itemId,
    unit: "KG",
    allocations: [{ lotId: f.lotId, quantity }],
  };
}
export function saleFor(
  f: Awaited<ReturnType<typeof fixture>>,
  quantity = "2.125",
) {
  return {
    idempotencyKey: randomUUID(),
    buyer: "TEST BUYER",
    saleDate: "2026-09-28",
    items: [
      {
        productId: f.productId,
        unitPriceMinor: "3500000",
        allocations: [{ lotId: f.lotId, quantity }],
      },
    ],
  };
}

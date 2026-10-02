import type { Database, Sql } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import type { ProductItemOption, ProductSummary } from "./contracts.js";

async function assertFarmOwner(tx: Sql, actorId: string, farmId: string) {
  const farm = await tx.query<{ id: string }>(
    "SELECT f.id FROM farm f JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2 WHERE f.id=$1 AND f.archived_at IS NULL",
    [farmId, actorId],
  );
  if (!farm.rows[0]) throw new DomainError("FORBIDDEN");
}
type ProductRow = {
  id: string;
  inventory_item_id: string;
  inventory_item_name: string;
  commodity_id: string;
  commodity_name: string;
  farming_type: ProductSummary["type"];
  name: string;
  grade: string | null;
  unit: ProductSummary["unit"];
  target_price_minor: string | null;
  status: ProductSummary["status"];
};
const selectProduct = `SELECT p.id,p.inventory_item_id,i.name AS inventory_item_name,
  p.commodity_id,c.name AS commodity_name,c.farming_type,
  p.name,p.grade,p.unit,p.target_price_minor::text AS target_price_minor,p.status
  FROM product p JOIN inventory_item i ON i.farm_id=p.farm_id AND i.id=p.inventory_item_id
  JOIN commodity c ON c.farm_id=p.farm_id AND c.id=p.commodity_id`;
function summary(row: ProductRow): ProductSummary {
  return {
    id: row.id,
    inventoryItemId: row.inventory_item_id,
    inventoryItemName: row.inventory_item_name,
    commodityId: row.commodity_id,
    commodityName: row.commodity_name,
    type: row.farming_type,
    name: row.name,
    grade: row.grade,
    unit: row.unit,
    targetPriceMinor: row.target_price_minor,
    status: row.status,
  };
}
export async function getProductInTransaction(
  tx: Sql,
  farmId: string,
  productId: string,
): Promise<ProductSummary> {
  const result = await tx.query<ProductRow>(
    `${selectProduct} WHERE p.farm_id=$1 AND p.id=$2`,
    [farmId, productId],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND");
  return summary(result.rows[0]);
}
export async function getProduct(
  db: Database,
  actorId: string,
  farmId: string,
  productId: string,
) {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(productId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    return getProductInTransaction(tx, farmId, productId);
  });
}
export async function listProducts(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<ProductSummary[]> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    const result = await tx.query<ProductRow>(
      `${selectProduct} WHERE p.farm_id=$1 ORDER BY p.name,p.id`,
      [farmId],
    );
    return result.rows.map(summary);
  });
}
export async function listProductItemOptions(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<ProductItemOption[]> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    const result = await tx.query<ProductItemOption>(
      `SELECT i.id,i.name,i.unit FROM inventory_item i
       LEFT JOIN product p ON p.farm_id=i.farm_id AND p.inventory_item_id=i.id
       WHERE i.farm_id=$1 AND i.category='HARVEST_PRODUCT' AND i.active=true
       AND p.id IS NULL ORDER BY i.name,i.id`,
      [farmId],
    );
    return result.rows;
  });
}

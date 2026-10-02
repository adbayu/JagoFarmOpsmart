import { randomUUID } from "node:crypto";
import type { Database } from "../../server/db.js";
import { command } from "../../server/command.js";
import type { CommandContext, Unit } from "../../shared/domain.js";
import { assertMoneyRange } from "../../shared/decimal.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import { createProductInput, updateProductInput } from "./contracts.js";
import { getProductInTransaction } from "./queries.js";

export async function createProduct(
  db: Database,
  context: CommandContext,
  raw: unknown,
) {
  const input = createProductInput.parse(raw);
  if (input.targetPriceMinor) assertMoneyRange(BigInt(input.targetPriceMinor));
  return command(
    db,
    context,
    "products.createProduct",
    input.idempotencyKey,
    input,
    async (tx) => {
      const item = await tx.query<{ unit: Unit }>(
        "SELECT unit FROM inventory_item WHERE farm_id=$1 AND id=$2 AND category='HARVEST_PRODUCT' AND active=true",
        [context.farmId, input.inventoryItemId],
      );
      if (!item.rows[0]) throw new DomainError("NOT_FOUND");
      const commodity = await tx.query<{ id: string }>(
        "SELECT id FROM commodity WHERE farm_id=$1 AND id=$2",
        [context.farmId, input.commodityId],
      );
      if (!commodity.rows[0]) throw new DomainError("NOT_FOUND");
      const id = randomUUID();
      await tx.query(
        `INSERT INTO product(id,farm_id,commodity_id,inventory_item_id,name,grade,unit,target_price_minor)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          context.farmId,
          input.commodityId,
          input.inventoryItemId,
          input.name,
          input.grade ?? null,
          item.rows[0].unit,
          input.targetPriceMinor ?? null,
        ],
      );
      return getProductInTransaction(tx, context.farmId, id);
    },
  );
}
export async function updateProduct(
  db: Database,
  context: CommandContext,
  productId: string,
  raw: unknown,
) {
  uuid.parse(productId);
  const input = updateProductInput.parse(raw);
  if (input.targetPriceMinor) assertMoneyRange(BigInt(input.targetPriceMinor));
  return command(
    db,
    context,
    "products.updateProduct",
    input.idempotencyKey,
    { productId, ...input },
    async (tx) => {
      const original = await tx.query<{
        grade: string | null;
        inventory_item_id: string;
      }>(
        "SELECT grade,inventory_item_id FROM product WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, productId],
      );
      if (!original.rows[0]) throw new DomainError("NOT_FOUND");
      if (input.status === "ACTIVE") {
        const item = await tx.query<{ active: boolean }>(
          "SELECT active FROM inventory_item WHERE farm_id=$1 AND id=$2",
          [context.farmId, original.rows[0].inventory_item_id],
        );
        if (!item.rows[0]?.active) throw new DomainError("CONFLICT");
      }
      if (original.rows[0].grade !== input.grade) {
        const used = await tx.query<{ id: string }>(
          `SELECT id FROM harvest_output WHERE farm_id=$1 AND product_id=$2
         UNION ALL SELECT id FROM sale_item WHERE farm_id=$1 AND product_id=$2 LIMIT 1`,
          [context.farmId, productId],
        );
        if (used.rows[0]) throw new DomainError("CONFLICT");
      }
      await tx.query(
        `UPDATE product SET name=$3,grade=$4,target_price_minor=$5,status=$6,
       updated_at=now() WHERE farm_id=$1 AND id=$2`,
        [
          context.farmId,
          productId,
          input.name,
          input.grade,
          input.targetPriceMinor,
          input.status,
        ],
      );
      return getProductInTransaction(tx, context.farmId, productId);
    },
  );
}

import { randomUUID } from "node:crypto";
import type { Database } from "../../server/db.js";
import { command } from "../../server/command.js";
import type { CommandContext, Unit } from "../../shared/domain.js";
import { saleInput } from "../../shared/validation.js";
import {
  assertMoneyRange,
  decimal,
  lineTotal,
  scaled,
} from "../../shared/decimal.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import { cancelSaleInput } from "./contracts.js";
import { deduct } from "../inventory/ledger.js";
import { recordInventoryLevelTransitions } from "../notifications/stock-events.js";

/** Representative direct-completion flow. Payment collection/recognition are separate future commands. */
export async function completeSale(
  db: Database,
  context: CommandContext,
  raw: unknown,
): Promise<{ saleId: string; totalMinor: string }> {
  const input = saleInput.parse(raw);
  return command(
    db,
    context,
    "sales.complete",
    input.idempotencyKey,
    input,
    async (tx) => {
      const saleId = randomUUID();
      const lines = [];
      let total = 0n;
      for (const item of input.items) {
        const products = await tx.query<{
          inventory_item_id: string;
          unit: Unit;
        }>(
          "SELECT inventory_item_id,unit FROM product WHERE farm_id=$1 AND id=$2 AND status='ACTIVE'",
          [context.farmId, item.productId],
        );
        const product = products.rows[0];
        if (!product) throw new DomainError("NOT_FOUND");
        const quantity = item.allocations.reduce(
          (sum, a) => sum + scaled(a.quantity),
          0n,
        );
        const amount = lineTotal(quantity, BigInt(item.unitPriceMinor));
        assertMoneyRange(amount);
        total += amount;
        lines.push({ item, product, quantity, amount });
      }
      assertMoneyRange(total);
      await tx.query(
        `INSERT INTO sale(id,farm_id,buyer,sale_date,status,total_minor,created_by)
      VALUES($1,$2,$3,$4,'COMPLETED',$5,$6)`,
        [
          saleId,
          context.farmId,
          input.buyer,
          input.saleDate,
          total.toString(),
          context.actorId,
        ],
      );
      for (const { item, product, quantity, amount } of lines) {
        const saleItemId = randomUUID();
        await tx.query(
          `INSERT INTO sale_item(id,farm_id,sale_id,product_id,inventory_item_id,quantity,unit_price_minor,total_minor)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            saleItemId,
            context.farmId,
            saleId,
            item.productId,
            product.inventory_item_id,
            decimal(quantity),
            item.unitPriceMinor,
            amount.toString(),
          ],
        );
        await deduct(
          tx,
          context,
          product.inventory_item_id,
          product.unit,
          item.allocations,
          { saleItemId },
        );
      }
      await recordInventoryLevelTransitions(
        tx,
        context.farmId,
        lines.map((line) => line.product.inventory_item_id),
      );
      return { saleId, totalMinor: total.toString() };
    },
  );
}
export async function cancelSale(
  db: Database,
  context: CommandContext,
  saleId: string,
  raw: unknown,
) {
  uuid.parse(saleId);
  const input = cancelSaleInput.parse(raw);
  return command(
    db,
    context,
    "sales.cancel",
    input.idempotencyKey,
    { saleId, ...input },
    async (tx) => {
      const sale = await tx.query<{ status: string }>(
        "SELECT status FROM sale WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, saleId],
      );
      if (!sale.rows[0]) throw new DomainError("NOT_FOUND");
      if (sale.rows[0].status !== "COMPLETED")
        throw new DomainError("CONFLICT");
      const payments = await tx.query<{ net: string }>(
        `SELECT COALESCE(sum(CASE WHEN kind='PAYMENT' THEN amount_minor ELSE -amount_minor END),0)::text AS net
         FROM sale_payment WHERE farm_id=$1 AND sale_id=$2 AND status='POSTED'`,
        [context.farmId, saleId],
      );
      if (BigInt(payments.rows[0]!.net) !== 0n)
        throw new DomainError("CONFLICT");
      // command() serializes this farm; ledger rows remain read-only.
      const movements = await tx.query<{
        id: string;
        lot_id: string;
        inventory_item_id: string;
        quantity_delta: string;
        unit: Unit;
      }>(
        `SELECT m.id,m.lot_id,m.inventory_item_id,m.quantity_delta::text AS quantity_delta,m.unit
       FROM sale_item si JOIN inventory_movement m ON m.farm_id=si.farm_id AND m.sale_item_id=si.id
       WHERE si.farm_id=$1 AND si.sale_id=$2 ORDER BY m.id`,
        [context.farmId, saleId],
      );
      if (!movements.rows.length) throw new DomainError("CONFLICT");
      for (const movement of movements.rows) {
        const previous = await tx.query<{ id: string }>(
          "SELECT id FROM inventory_movement WHERE farm_id=$1 AND reversal_of=$2",
          [context.farmId, movement.id],
        );
        if (previous.rows[0]) throw new DomainError("CONFLICT");
        await tx.query(
          `INSERT INTO inventory_movement(id,farm_id,lot_id,inventory_item_id,type,quantity_delta,unit,reversal_of,reason,created_by)
         VALUES($1,$2,$3,$4,'REVERSAL',$5,$6,$7,$8,$9)`,
          [
            randomUUID(),
            context.farmId,
            movement.lot_id,
            movement.inventory_item_id,
            decimal(-scaled(movement.quantity_delta)),
            movement.unit,
            movement.id,
            input.reason,
            context.actorId,
          ],
        );
      }
      await recordInventoryLevelTransitions(
        tx,
        context.farmId,
        movements.rows.map((movement) => movement.inventory_item_id),
      );
      await tx.query(
        "UPDATE sale SET status='CANCELLED',cancelled_at=now(),cancelled_by=$3,updated_at=now() WHERE farm_id=$1 AND id=$2",
        [context.farmId, saleId, context.actorId],
      );
      return { saleId, status: "CANCELLED" as const };
    },
  );
}

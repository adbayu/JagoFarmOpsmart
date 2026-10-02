import { randomUUID } from "node:crypto";
import type { Sql } from "../../server/db.js";
import type { CommandContext, Unit } from "../../shared/domain.js";
import { decimal, scaled, validateUnitQuantity } from "../../shared/decimal.js";
import { DomainError } from "../../shared/errors.js";

/** Internal: caller must hold the farm write lock through commit. */
export async function deduct(
  tx: Sql,
  context: CommandContext,
  itemId: string,
  unit: Unit,
  allocations: { lotId: string; quantity: string }[],
  source: { consumptionId: string } | { saleItemId: string },
): Promise<void> {
  if (new Set(allocations.map((a) => a.lotId)).size !== allocations.length)
    throw new DomainError("VALIDATION");
  for (const allocation of allocations) {
    const quantity = scaled(allocation.quantity);
    validateUnitQuantity(quantity, unit);
    const lot = await tx.query(
      `SELECT l.id FROM inventory_lot l JOIN inventory_item i
      ON i.farm_id=l.farm_id AND i.id=l.inventory_item_id
      WHERE l.farm_id=$1 AND l.id=$2 AND l.inventory_item_id=$3 AND i.unit=$4
      AND i.active=true AND (l.expires_on IS NULL OR l.expires_on>=CURRENT_DATE)`,
      [context.farmId, allocation.lotId, itemId, unit],
    );
    if (!lot.rows.length) throw new DomainError("NOT_FOUND");
    const balance = await tx.query<{ quantity: string }>(
      "SELECT COALESCE(sum(quantity_delta),0)::text AS quantity FROM inventory_movement WHERE farm_id=$1 AND lot_id=$2",
      [context.farmId, allocation.lotId],
    );
    if (scaled(balance.rows[0]!.quantity) < quantity)
      throw new DomainError("INSUFFICIENT_STOCK");
    const consumptionId =
      "consumptionId" in source ? source.consumptionId : null;
    const saleItemId = "saleItemId" in source ? source.saleItemId : null;
    await tx.query(
      `INSERT INTO inventory_movement(id,farm_id,lot_id,inventory_item_id,type,quantity_delta,unit,consumption_id,sale_item_id,reason,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        randomUUID(),
        context.farmId,
        allocation.lotId,
        itemId,
        consumptionId ? "CONSUMPTION" : "STOCK_OUT",
        decimal(-quantity),
        unit,
        consumptionId,
        saleItemId,
        consumptionId ? "Operational consumption" : "Completed sale",
        context.actorId,
      ],
    );
  }
}

import { randomUUID } from "node:crypto";
import type { Database } from "../../server/db.js";
import { command } from "../../server/command.js";
import type { CommandContext, Unit } from "../../shared/domain.js";
import { decimal, scaled, validateUnitQuantity } from "../../shared/decimal.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import { recordInventoryLevelTransitions } from "../notifications/stock-events.js";
import {
  cancelHarvestInput,
  postHarvestInput,
  type HarvestReceipt,
} from "./contracts.js";

export async function postHarvest(
  db: Database,
  context: CommandContext,
  raw: unknown,
): Promise<HarvestReceipt> {
  const input = postHarvestInput.parse(raw);
  return command(
    db,
    context,
    "harvest.post",
    input.idempotencyKey,
    input,
    async (tx) => {
      const cycle = await tx.query<{
        commodity_id: string;
        status: string;
        start_date: string;
      }>(
        "SELECT commodity_id,status,start_date::text AS start_date FROM farming_cycle WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, input.cycleId],
      );
      const current = cycle.rows[0];
      if (!current) throw new DomainError("NOT_FOUND");
      if (current.status !== "ACTIVE" || input.harvestDate < current.start_date)
        throw new DomainError("CONFLICT");
      const harvestId = randomUUID();
      await tx.query(
        `INSERT INTO harvest(id,farm_id,cycle_id,harvest_date,location,notes,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          harvestId,
          context.farmId,
          input.cycleId,
          input.harvestDate,
          input.location ?? null,
          input.notes ?? null,
          context.actorId,
        ],
      );
      const outputs: HarvestReceipt["outputs"] = [];
      const inventoryItemIds: string[] = [];
      for (const output of input.outputs) {
        const result = await tx.query<{
          inventory_item_id: string;
          unit: Unit;
        }>(
          `SELECT p.inventory_item_id,p.unit FROM product p JOIN inventory_item i
         ON i.farm_id=p.farm_id AND i.id=p.inventory_item_id
         WHERE p.farm_id=$1 AND p.id=$2 AND p.commodity_id=$3 AND p.status='ACTIVE'
         AND i.category='HARVEST_PRODUCT' AND i.active=true`,
          [context.farmId, output.productId, current.commodity_id],
        );
        const product = result.rows[0];
        if (!product) throw new DomainError("CONFLICT");
        const quantity = scaled(output.quantity);
        validateUnitQuantity(quantity, product.unit);
        const outputId = randomUUID();
        const lotId = randomUUID();
        const movementId = randomUUID();
        await tx.query(
          `INSERT INTO harvest_output(id,farm_id,harvest_id,product_id,inventory_item_id,quantity,weight_kg)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            outputId,
            context.farmId,
            harvestId,
            output.productId,
            product.inventory_item_id,
            decimal(quantity),
            output.weightKg ?? null,
          ],
        );
        await tx.query(
          `INSERT INTO inventory_lot(id,farm_id,inventory_item_id,harvest_output_id,label,location)
         VALUES($1,$2,$3,$4,$5,$6)`,
          [
            lotId,
            context.farmId,
            product.inventory_item_id,
            outputId,
            output.lotLabel,
            input.location ?? null,
          ],
        );
        await tx.query(
          `INSERT INTO inventory_movement(id,farm_id,lot_id,inventory_item_id,type,quantity_delta,unit,reason,created_by)
         VALUES($1,$2,$3,$4,'STOCK_IN',$5,$6,$7,$8)`,
          [
            movementId,
            context.farmId,
            lotId,
            product.inventory_item_id,
            decimal(quantity),
            product.unit,
            `Panen ${harvestId}`,
            context.actorId,
          ],
        );
        outputs.push({ outputId, lotId, movementId });
        inventoryItemIds.push(product.inventory_item_id);
      }
      await recordInventoryLevelTransitions(
        tx,
        context.farmId,
        inventoryItemIds,
      );
      return { harvestId, outputs };
    },
  );
}

export async function cancelHarvest(
  db: Database,
  context: CommandContext,
  harvestId: string,
  raw: unknown,
): Promise<{ harvestId: string; status: "CANCELLED" }> {
  uuid.parse(harvestId);
  const input = cancelHarvestInput.parse(raw);
  return command(
    db,
    context,
    "harvest.cancel",
    input.idempotencyKey,
    { harvestId, ...input },
    async (tx) => {
      const harvest = await tx.query<{ status: string }>(
        "SELECT status FROM harvest WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, harvestId],
      );
      if (!harvest.rows[0]) throw new DomainError("NOT_FOUND");
      if (harvest.rows[0].status !== "POSTED")
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
       FROM harvest_output o JOIN inventory_lot l ON l.farm_id=o.farm_id AND l.harvest_output_id=o.id
       JOIN inventory_movement m ON m.farm_id=l.farm_id AND m.lot_id=l.id AND m.type='STOCK_IN'
       WHERE o.farm_id=$1 AND o.harvest_id=$2 ORDER BY m.id`,
        [context.farmId, harvestId],
      );
      const count = await tx.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM harvest_output WHERE farm_id=$1 AND harvest_id=$2",
        [context.farmId, harvestId],
      );
      if (movements.rows.length !== Number(count.rows[0]?.count))
        throw new DomainError("CONFLICT");
      for (const movement of movements.rows) {
        const balance = await tx.query<{ quantity: string }>(
          "SELECT COALESCE(sum(quantity_delta),0)::text AS quantity FROM inventory_movement WHERE farm_id=$1 AND lot_id=$2",
          [context.farmId, movement.lot_id],
        );
        if (scaled(balance.rows[0]!.quantity) < scaled(movement.quantity_delta))
          throw new DomainError("INSUFFICIENT_STOCK");
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
        "UPDATE harvest SET status='CANCELLED',cancelled_at=now(),cancelled_by=$3,updated_at=now() WHERE farm_id=$1 AND id=$2",
        [context.farmId, harvestId, context.actorId],
      );
      return { harvestId, status: "CANCELLED" as const };
    },
  );
}

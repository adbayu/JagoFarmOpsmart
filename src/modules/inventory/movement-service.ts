import { randomUUID } from "node:crypto";
import type { Database, Sql } from "../../server/db.js";
import { command } from "../../server/command.js";
import type { CommandContext, Unit } from "../../shared/domain.js";
import { decimal, scaled, validateUnitQuantity } from "../../shared/decimal.js";
import { DomainError } from "../../shared/errors.js";
import { recordInventoryLevelTransitions } from "../notifications/stock-events.js";
import {
  adjustStockInput,
  disposeStockInput,
  reverseMovementInput,
  stockInInput,
  transferStockInput,
} from "./contracts.js";

type LotForWrite = {
  id: string;
  inventory_item_id: string;
  harvest_output_id: string | null;
  category: string;
  unit: Unit;
  active: boolean;
};
async function lotForWrite(
  tx: Sql,
  farmId: string,
  lotId: string,
): Promise<LotForWrite> {
  const result = await tx.query<LotForWrite>(
    `SELECT l.id,l.inventory_item_id,l.harvest_output_id,i.category,i.unit,i.active
     FROM inventory_lot l JOIN inventory_item i
     ON i.farm_id=l.farm_id AND i.id=l.inventory_item_id
     WHERE l.farm_id=$1 AND l.id=$2 FOR UPDATE OF l`,
    [farmId, lotId],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND");
  if (!result.rows[0].active) throw new DomainError("CONFLICT");
  return result.rows[0];
}
async function balance(
  tx: Sql,
  farmId: string,
  lotId: string,
): Promise<bigint> {
  const result = await tx.query<{ quantity: string }>(
    "SELECT COALESCE(sum(quantity_delta),0)::text AS quantity FROM inventory_movement WHERE farm_id=$1 AND lot_id=$2",
    [farmId, lotId],
  );
  return scaled(result.rows[0]!.quantity);
}
async function append(
  tx: Sql,
  context: CommandContext,
  lot: LotForWrite,
  type:
    "STOCK_IN" | "ADJUSTMENT" | "TRANSFER" | "EXPIRED" | "DAMAGED" | "REVERSAL",
  delta: bigint,
  reason: string,
  reversalOf: string | null = null,
  transferGroup: string | null = null,
): Promise<string> {
  if (delta === 0n) throw new DomainError("VALIDATION");
  validateUnitQuantity(delta < 0n ? -delta : delta, lot.unit);
  if (delta < 0n && (await balance(tx, context.farmId, lot.id)) < -delta)
    throw new DomainError("INSUFFICIENT_STOCK");
  const id = randomUUID();
  await tx.query(
    `INSERT INTO inventory_movement
     (id,farm_id,lot_id,inventory_item_id,type,quantity_delta,unit,
      reversal_of,transfer_group,reason,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      context.farmId,
      lot.id,
      lot.inventory_item_id,
      type,
      decimal(delta),
      lot.unit,
      reversalOf,
      transferGroup,
      reason,
      context.actorId,
    ],
  );
  return id;
}
export async function stockIn(
  db: Database,
  context: CommandContext,
  raw: unknown,
) {
  const input = stockInInput.parse(raw);
  return command(
    db,
    context,
    "inventory.stockIn",
    input.idempotencyKey,
    input,
    async (tx) => {
      const lot = await lotForWrite(tx, context.farmId, input.lotId);
      if (lot.category === "HARVEST_PRODUCT" || lot.harvest_output_id)
        throw new DomainError("CONFLICT");
      const movementId = await append(
        tx,
        context,
        lot,
        "STOCK_IN",
        scaled(input.quantity),
        input.reason,
      );
      await recordInventoryLevelTransitions(tx, context.farmId, [
        lot.inventory_item_id,
      ]);
      return { movementId };
    },
  );
}

export async function stockInCircularFeedInTransaction(
  tx: Sql,
  context: CommandContext,
  lotId: string,
  quantity: bigint,
  unit: Unit,
  reason: string,
): Promise<string> {
  const lot = await lotForWrite(tx, context.farmId, lotId);
  if (lot.category !== "FEED" || lot.unit !== unit)
    throw new DomainError("CONFLICT");
  const movementId = await append(
    tx,
    context,
    lot,
    "STOCK_IN",
    quantity,
    reason,
  );
  await recordInventoryLevelTransitions(tx, context.farmId, [
    lot.inventory_item_id,
  ]);
  return movementId;
}

export async function adjustStock(
  db: Database,
  context: CommandContext,
  raw: unknown,
) {
  const input = adjustStockInput.parse(raw);
  return command(
    db,
    context,
    "inventory.adjustStock",
    input.idempotencyKey,
    input,
    async (tx) => {
      const lot = await lotForWrite(tx, context.farmId, input.lotId);
      if (
        lot.category === "HARVEST_PRODUCT" &&
        scaled(input.quantityDelta) > 0n
      )
        throw new DomainError("CONFLICT");
      const movementId = await append(
        tx,
        context,
        lot,
        "ADJUSTMENT",
        scaled(input.quantityDelta),
        input.reason,
      );
      await recordInventoryLevelTransitions(tx, context.farmId, [
        lot.inventory_item_id,
      ]);
      return { movementId };
    },
  );
}
export async function transferStock(
  db: Database,
  context: CommandContext,
  raw: unknown,
) {
  const input = transferStockInput.parse(raw);
  if (input.fromLotId === input.toLotId) throw new DomainError("VALIDATION");
  return command(
    db,
    context,
    "inventory.transferStock",
    input.idempotencyKey,
    input,
    async (tx) => {
      // Farm command lock serializes writers; ordered lot reads keep the lock order explicit.
      const ids = [input.fromLotId, input.toLotId].sort();
      const first = await lotForWrite(tx, context.farmId, ids[0]!);
      const second = await lotForWrite(tx, context.farmId, ids[1]!);
      const from = first.id === input.fromLotId ? first : second;
      const to = first.id === input.toLotId ? first : second;
      if (
        from.inventory_item_id !== to.inventory_item_id ||
        from.unit !== to.unit
      )
        throw new DomainError("CONFLICT");
      if (from.category === "HARVEST_PRODUCT")
        throw new DomainError("CONFLICT");
      const quantity = scaled(input.quantity);
      const transferGroupId = randomUUID();
      const outId = await append(
        tx,
        context,
        from,
        "TRANSFER",
        -quantity,
        input.reason,
        null,
        transferGroupId,
      );
      const inId = await append(
        tx,
        context,
        to,
        "TRANSFER",
        quantity,
        input.reason,
        null,
        transferGroupId,
      );
      await recordInventoryLevelTransitions(tx, context.farmId, [
        from.inventory_item_id,
      ]);
      return { transferGroupId, movementIds: [outId, inId] };
    },
  );
}
export async function disposeStock(
  db: Database,
  context: CommandContext,
  raw: unknown,
) {
  const input = disposeStockInput.parse(raw);
  return command(
    db,
    context,
    "inventory.disposeStock",
    input.idempotencyKey,
    input,
    async (tx) => {
      const lot = await lotForWrite(tx, context.farmId, input.lotId);
      const movementId = await append(
        tx,
        context,
        lot,
        input.type,
        -scaled(input.quantity),
        input.reason,
      );
      await recordInventoryLevelTransitions(tx, context.farmId, [
        lot.inventory_item_id,
      ]);
      return { movementId };
    },
  );
}
type Original = {
  id: string;
  lot_id: string;
  inventory_item_id: string;
  type: string;
  quantity_delta: string;
  unit: Unit;
  transfer_group: string | null;
  consumption_id: string | null;
  sale_item_id: string | null;
};
export async function reverseMovement(
  db: Database,
  context: CommandContext,
  raw: unknown,
) {
  const input = reverseMovementInput.parse(raw);
  return command(
    db,
    context,
    "inventory.reverseMovement",
    input.idempotencyKey,
    input,
    async (tx) => {
      // command() holds the farm lock, so immutable ledger rows need no row UPDATE lock.
      const original = await tx.query<Original>(
        `SELECT id,lot_id,inventory_item_id,type,quantity_delta::text AS quantity_delta,
       unit,transfer_group,consumption_id,sale_item_id
       FROM inventory_movement WHERE farm_id=$1 AND id=$2`,
        [context.farmId, input.movementId],
      );
      const target = original.rows[0];
      if (!target) throw new DomainError("NOT_FOUND");
      if (
        target.type === "REVERSAL" ||
        target.consumption_id ||
        target.sale_item_id
      )
        throw new DomainError("CONFLICT");
      const originals =
        target.type === "TRANSFER"
          ? (
              await tx.query<Original>(
                `SELECT id,lot_id,inventory_item_id,type,quantity_delta::text AS quantity_delta,
           unit,transfer_group,consumption_id,sale_item_id
           FROM inventory_movement WHERE farm_id=$1 AND transfer_group=$2 ORDER BY id`,
                [context.farmId, target.transfer_group],
              )
            ).rows
          : [target];
      if (
        target.type === "TRANSFER" &&
        (originals.length !== 2 ||
          originals.some((row) => row.type !== "TRANSFER") ||
          scaled(originals[0]!.quantity_delta) +
            scaled(originals[1]!.quantity_delta) !==
            0n)
      )
        throw new DomainError("CONFLICT");
      const movementIds: string[] = [];
      for (const row of originals) {
        const already = await tx.query<{ id: string }>(
          "SELECT id FROM inventory_movement WHERE farm_id=$1 AND reversal_of=$2",
          [context.farmId, row.id],
        );
        if (already.rows[0]) throw new DomainError("CONFLICT");
        const lot = await lotForWrite(tx, context.farmId, row.lot_id);
        if (
          lot.inventory_item_id !== row.inventory_item_id ||
          lot.unit !== row.unit ||
          (lot.harvest_output_id && row.type === "STOCK_IN")
        )
          throw new DomainError("CONFLICT");
        movementIds.push(
          await append(
            tx,
            context,
            lot,
            "REVERSAL",
            -scaled(row.quantity_delta),
            input.reason,
            row.id,
          ),
        );
      }
      await recordInventoryLevelTransitions(
        tx,
        context.farmId,
        originals.map((row) => row.inventory_item_id),
      );
      return { movementIds };
    },
  );
}

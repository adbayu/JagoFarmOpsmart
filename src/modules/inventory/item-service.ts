import { randomUUID } from "node:crypto";
import type { Database } from "../../server/db.js";
import { command } from "../../server/command.js";
import type { CommandContext, Unit } from "../../shared/domain.js";
import { scaled } from "../../shared/decimal.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import {
  createInventoryItemInput,
  createInventoryLotInput,
  updateInventoryItemInput,
  updateInventoryLotInput,
  type InventoryItemSummary,
  type InventoryLotSummary,
} from "./contracts.js";
import { getItemInTransaction, getLotInTransaction } from "./queries.js";
import { recordInventoryLevelTransitions } from "../notifications/stock-events.js";

function assertMinimumStock(value: string, unit: Unit) {
  if (["UNIT", "HEAD", "SEED"].includes(unit) && scaled(value) % 1000n !== 0n)
    throw new DomainError("VALIDATION");
}
export async function createItem(
  db: Database,
  context: CommandContext,
  raw: unknown,
): Promise<InventoryItemSummary> {
  const input = createInventoryItemInput.parse(raw);
  assertMinimumStock(input.minimumStock ?? "0", input.unit);
  return command(
    db,
    context,
    "inventory.createItem",
    input.idempotencyKey,
    input,
    async (tx) => {
      const id = randomUUID();
      await tx.query(
        `INSERT INTO inventory_item(id,farm_id,name,category,unit,minimum_stock)
       VALUES($1,$2,$3,$4,$5,$6)`,
        [
          id,
          context.farmId,
          input.name,
          input.category,
          input.unit,
          input.minimumStock ?? "0",
        ],
      );
      await recordInventoryLevelTransitions(tx, context.farmId, [id]);
      return getItemInTransaction(tx, context.farmId, id);
    },
  );
}
export async function updateItem(
  db: Database,
  context: CommandContext,
  itemId: string,
  raw: unknown,
): Promise<InventoryItemSummary> {
  uuid.parse(itemId);
  const input = updateInventoryItemInput.parse(raw);
  assertMinimumStock(input.minimumStock, input.unit);
  return command(
    db,
    context,
    "inventory.updateItem",
    input.idempotencyKey,
    { itemId, ...input },
    async (tx) => {
      const existing = await tx.query<{ unit: Unit; category: string }>(
        "SELECT unit,category FROM inventory_item WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, itemId],
      );
      if (!existing.rows[0]) throw new DomainError("NOT_FOUND");
      if (
        existing.rows[0].unit !== input.unit ||
        existing.rows[0].category !== input.category
      ) {
        const used = await tx.query<{ id: string }>(
          "SELECT id FROM inventory_movement WHERE farm_id=$1 AND inventory_item_id=$2 LIMIT 1",
          [context.farmId, itemId],
        );
        if (used.rows[0]) throw new DomainError("CONFLICT");
      }
      if (!input.active) {
        const activeProduct = await tx.query<{ id: string }>(
          "SELECT id FROM product WHERE farm_id=$1 AND inventory_item_id=$2 AND status='ACTIVE' LIMIT 1",
          [context.farmId, itemId],
        );
        if (activeProduct.rows[0]) throw new DomainError("CONFLICT");
        const balance = await tx.query<{ quantity: string }>(
          "SELECT COALESCE(sum(quantity_delta),0)::text AS quantity FROM inventory_movement WHERE farm_id=$1 AND inventory_item_id=$2",
          [context.farmId, itemId],
        );
        if (scaled(balance.rows[0]!.quantity) !== 0n)
          throw new DomainError("CONFLICT");
      }
      await tx.query(
        `UPDATE inventory_item SET name=$3,category=$4,unit=$5,
       minimum_stock=$6,active=$7,updated_at=now() WHERE farm_id=$1 AND id=$2`,
        [
          context.farmId,
          itemId,
          input.name,
          input.category,
          input.unit,
          input.minimumStock,
          input.active,
        ],
      );
      await recordInventoryLevelTransitions(tx, context.farmId, [itemId]);
      return getItemInTransaction(tx, context.farmId, itemId);
    },
  );
}
export async function createLot(
  db: Database,
  context: CommandContext,
  raw: unknown,
): Promise<InventoryLotSummary> {
  const input = createInventoryLotInput.parse(raw);
  return command(
    db,
    context,
    "inventory.createLot",
    input.idempotencyKey,
    input,
    async (tx) => {
      const item = await tx.query<{ active: boolean }>(
        "SELECT active FROM inventory_item WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, input.inventoryItemId],
      );
      if (!item.rows[0]) throw new DomainError("NOT_FOUND");
      if (!item.rows[0].active) throw new DomainError("CONFLICT");
      const id = randomUUID();
      await tx.query(
        `INSERT INTO inventory_lot(id,farm_id,inventory_item_id,label,location,expires_on)
       VALUES($1,$2,$3,$4,$5,$6)`,
        [
          id,
          context.farmId,
          input.inventoryItemId,
          input.label,
          input.location ?? null,
          input.expiresOn ?? null,
        ],
      );
      return getLotInTransaction(tx, context.farmId, id);
    },
  );
}
export async function updateLot(
  db: Database,
  context: CommandContext,
  lotId: string,
  raw: unknown,
): Promise<InventoryLotSummary> {
  uuid.parse(lotId);
  const input = updateInventoryLotInput.parse(raw);
  return command(
    db,
    context,
    "inventory.updateLot",
    input.idempotencyKey,
    { lotId, ...input },
    async (tx) => {
      const lot = await tx.query<{ id: string }>(
        "SELECT id FROM inventory_lot WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, lotId],
      );
      if (!lot.rows[0]) throw new DomainError("NOT_FOUND");
      await tx.query(
        `UPDATE inventory_lot SET label=$3,location=$4,expires_on=$5
       WHERE farm_id=$1 AND id=$2`,
        [context.farmId, lotId, input.label, input.location, input.expiresOn],
      );
      return getLotInTransaction(tx, context.farmId, lotId);
    },
  );
}

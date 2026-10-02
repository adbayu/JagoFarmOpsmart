import type { Database, Sql } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import type {
  InventoryItemSummary,
  InventoryLotSummary,
  MovementSummary,
  ConsumableOption,
  ConsumptionHistory,
} from "./contracts.js";

async function assertFarmOwner(tx: Sql, actorId: string, farmId: string) {
  const farm = await tx.query<{ id: string }>(
    "SELECT f.id FROM farm f JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2 WHERE f.id=$1 AND f.archived_at IS NULL",
    [farmId, actorId],
  );
  if (!farm.rows[0]) throw new DomainError("FORBIDDEN");
}
type ItemRow = {
  id: string;
  name: string;
  category: InventoryItemSummary["category"];
  unit: InventoryItemSummary["unit"];
  minimum_stock: string;
  quantity: string;
  lot_count: string;
  active: boolean;
};
const selectItem = `SELECT i.id,i.name,i.category,i.unit,
  i.minimum_stock::text AS minimum_stock,
  COALESCE(b.quantity,0)::text AS quantity,
  COALESCE(l.lot_count,0)::text AS lot_count,i.active
  FROM inventory_item i
  LEFT JOIN (SELECT farm_id,inventory_item_id,sum(quantity_delta) AS quantity
    FROM inventory_movement WHERE farm_id=$1 GROUP BY farm_id,inventory_item_id) b
    ON b.farm_id=i.farm_id AND b.inventory_item_id=i.id
  LEFT JOIN (SELECT farm_id,inventory_item_id,count(*) AS lot_count
    FROM inventory_lot WHERE farm_id=$1 GROUP BY farm_id,inventory_item_id) l
    ON l.farm_id=i.farm_id AND l.inventory_item_id=i.id`;
function itemSummary(row: ItemRow): InventoryItemSummary {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    minimumStock: row.minimum_stock,
    quantity: row.quantity,
    lotCount: Number(row.lot_count),
    active: row.active,
  };
}
export async function getItemInTransaction(
  tx: Sql,
  farmId: string,
  itemId: string,
) {
  const result = await tx.query<ItemRow>(
    `${selectItem} WHERE i.farm_id=$1 AND i.id=$2`,
    [farmId, itemId],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND");
  return itemSummary(result.rows[0]);
}
export async function getItem(
  db: Database,
  actorId: string,
  farmId: string,
  itemId: string,
) {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(itemId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    return getItemInTransaction(tx, farmId, itemId);
  });
}
export async function listItems(
  db: Database,
  actorId: string,
  farmId: string,
  limit = 50,
  offset = 0,
): Promise<{ items: InventoryItemSummary[]; nextOffset: number | null }> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    throw new DomainError("VALIDATION");
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    const result = await tx.query<ItemRow>(
      `${selectItem} WHERE i.farm_id=$1 ORDER BY i.name,i.id LIMIT $2 OFFSET $3`,
      [farmId, limit + 1, offset],
    );
    return {
      items: result.rows.slice(0, limit).map(itemSummary),
      nextOffset: result.rows.length > limit ? offset + limit : null,
    };
  });
}
type LotRow = {
  id: string;
  inventory_item_id: string;
  label: string;
  location: string | null;
  expires_on: string | null;
  quantity: string;
};
const selectLot = `SELECT l.id,l.inventory_item_id,l.label,l.location,
  l.expires_on::text AS expires_on,COALESCE(b.quantity,0)::text AS quantity
  FROM inventory_lot l LEFT JOIN stock_balance b
  ON b.farm_id=l.farm_id AND b.lot_id=l.id`;
function lotSummary(row: LotRow): InventoryLotSummary {
  return {
    id: row.id,
    inventoryItemId: row.inventory_item_id,
    label: row.label,
    location: row.location,
    expiresOn: row.expires_on,
    quantity: row.quantity,
  };
}
export async function getLotInTransaction(
  tx: Sql,
  farmId: string,
  lotId: string,
) {
  const result = await tx.query<LotRow>(
    `${selectLot} WHERE l.farm_id=$1 AND l.id=$2`,
    [farmId, lotId],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND");
  return lotSummary(result.rows[0]);
}
export async function getLot(
  db: Database,
  actorId: string,
  farmId: string,
  lotId: string,
) {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(lotId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    return getLotInTransaction(tx, farmId, lotId);
  });
}
export async function listLots(
  db: Database,
  actorId: string,
  farmId: string,
  itemId: string,
) {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(itemId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    await getItemInTransaction(tx, farmId, itemId);
    const result = await tx.query<LotRow>(
      `${selectLot} WHERE l.farm_id=$1 AND l.inventory_item_id=$2 ORDER BY l.created_at,l.id`,
      [farmId, itemId],
    );
    return result.rows.map(lotSummary);
  });
}

type MovementRow = {
  id: string;
  inventory_item_id: string;
  item_name: string;
  lot_id: string;
  lot_label: string;
  type: MovementSummary["type"];
  quantity_delta: string;
  unit: MovementSummary["unit"];
  reason: string;
  reversal_of: string | null;
  transfer_group: string | null;
  created_at: string;
};
export async function listMovements(
  db: Database,
  actorId: string,
  farmId: string,
  itemId?: string,
  limit = 50,
  offset = 0,
): Promise<{ movements: MovementSummary[]; nextOffset: number | null }> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  if (itemId) uuid.parse(itemId);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    throw new DomainError("VALIDATION");
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    const result = await tx.query<MovementRow>(
      `SELECT m.id,m.inventory_item_id,i.name AS item_name,m.lot_id,l.label AS lot_label,
       m.type,m.quantity_delta::text AS quantity_delta,m.unit,m.reason,m.reversal_of,
       m.transfer_group,m.created_at::text AS created_at
       FROM inventory_movement m
       JOIN inventory_item i ON i.farm_id=m.farm_id AND i.id=m.inventory_item_id
       JOIN inventory_lot l ON l.farm_id=m.farm_id AND l.id=m.lot_id
       WHERE m.farm_id=$1 AND ($2::uuid IS NULL OR m.inventory_item_id=$2)
       ORDER BY m.created_at DESC,m.id DESC LIMIT $3 OFFSET $4`,
      [farmId, itemId ?? null, limit + 1, offset],
    );
    return {
      movements: result.rows.slice(0, limit).map((row) => ({
        id: row.id,
        inventoryItemId: row.inventory_item_id,
        itemName: row.item_name,
        lotId: row.lot_id,
        lotLabel: row.lot_label,
        type: row.type,
        quantityDelta: row.quantity_delta,
        unit: row.unit,
        reason: row.reason,
        reversalOf: row.reversal_of,
        transferGroup: row.transfer_group,
        createdAt: row.created_at,
      })),
      nextOffset: result.rows.length > limit ? offset + limit : null,
    };
  });
}

type ConsumableRow = {
  item_id: string;
  item_name: string;
  unit: ConsumableOption["unit"];
  lot_id: string;
  lot_label: string;
  quantity: string;
};
export async function listConsumableOptions(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<ConsumableOption[]> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    const result = await tx.query<ConsumableRow>(
      `SELECT i.id AS item_id,i.name AS item_name,i.unit,l.id AS lot_id,
       l.label AS lot_label,b.quantity::text AS quantity
       FROM stock_balance b
       JOIN inventory_lot l ON l.farm_id=b.farm_id AND l.id=b.lot_id
       JOIN inventory_item i ON i.farm_id=b.farm_id AND i.id=b.inventory_item_id
       WHERE b.farm_id=$1 AND i.active=true AND b.quantity>0
       AND (l.expires_on IS NULL OR l.expires_on>=CURRENT_DATE)
       ORDER BY i.name,i.id,l.label,l.id`,
      [farmId],
    );
    const options = new Map<string, ConsumableOption>();
    for (const row of result.rows) {
      let option = options.get(row.item_id);
      if (!option) {
        option = {
          itemId: row.item_id,
          itemName: row.item_name,
          unit: row.unit,
          lots: [],
        };
        options.set(row.item_id, option);
      }
      option.lots.push({
        lotId: row.lot_id,
        lotLabel: row.lot_label,
        quantity: row.quantity,
      });
    }
    return [...options.values()];
  });
}

type ConsumptionRow = {
  consumption_id: string;
  movement_id: string;
  item_name: string;
  lot_label: string;
  quantity: string;
  unit: ConsumptionHistory["unit"];
  created_at: string;
};
export async function listActivityConsumptions(
  db: Database,
  actorId: string,
  farmId: string,
  activityId: string,
): Promise<ConsumptionHistory[]> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(activityId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    const result = await tx.query<ConsumptionRow>(
      `SELECT c.id AS consumption_id,m.id AS movement_id,
       i.name AS item_name,l.label AS lot_label,
       (-m.quantity_delta)::text AS quantity,m.unit,c.created_at::text AS created_at
       FROM consumption c
       JOIN inventory_movement m ON m.farm_id=c.farm_id AND m.consumption_id=c.id
       JOIN inventory_item i ON i.farm_id=c.farm_id AND i.id=c.inventory_item_id
       JOIN inventory_lot l ON l.farm_id=m.farm_id AND l.id=m.lot_id
       WHERE c.farm_id=$1 AND c.activity_id=$2
       ORDER BY c.created_at DESC,m.id`,
      [farmId, activityId],
    );
    return result.rows.map((row) => ({
      consumptionId: row.consumption_id,
      movementId: row.movement_id,
      itemName: row.item_name,
      lotLabel: row.lot_label,
      quantity: row.quantity,
      unit: row.unit,
      createdAt: row.created_at,
    }));
  });
}

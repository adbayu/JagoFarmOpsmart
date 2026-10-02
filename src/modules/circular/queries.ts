import type { Database } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import type {
  CircularFeedLotOption,
  WaterTransferSummary,
  WaterTransferUnitOption,
} from "./contracts.js";

async function assertFarmMember(
  tx: import("../../server/db.js").Sql,
  actorId: string,
  farmId: string,
) {
  const member = await tx.query<{ id: string }>(
    `SELECT f.id FROM farm f
     JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2
     WHERE f.id=$1 AND f.archived_at IS NULL`,
    [farmId, actorId],
  );
  if (!member.rows[0]) throw new DomainError("FORBIDDEN");
}

export async function listWaterTransferUnits(
  db: Database,
  actorId: string,
  farmId: string,
  type: "FISH" | "CROP",
): Promise<WaterTransferUnitOption[]> {
  return db.transaction(async (tx) => {
    await assertFarmMember(tx, actorId, farmId);
    const result = await tx.query<{ id: string; name: string }>(
      `SELECT id,name FROM farm_unit
       WHERE farm_id=$1 AND farming_type=$2 AND active=true
       ORDER BY name,id`,
      [farmId, type],
    );
    return result.rows;
  });
}

export async function listWaterTransfers(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<WaterTransferSummary[]> {
  return db.transaction(async (tx) => {
    await assertFarmMember(tx, actorId, farmId);
    const result = await tx.query<{
      id: string;
      source_unit_id: string;
      source_unit_name: string;
      target_unit_id: string;
      target_unit_name: string;
      quantity_liters: string;
      transfer_date: string;
      note: string | null;
      created_by_name: string;
      created_at: string;
    }>(
      `SELECT t.id,t.source_unit_id,s.name AS source_unit_name,
         t.target_unit_id,d.name AS target_unit_name,
         t.quantity_liters::text,t.transfer_date::text,t.note,
         u.display_name AS created_by_name,t.created_at::text
       FROM circular_water_transfer t
       JOIN farm_unit s ON s.farm_id=t.farm_id AND s.id=t.source_unit_id
       JOIN farm_unit d ON d.farm_id=t.farm_id AND d.id=t.target_unit_id
       JOIN app_user u ON u.id=t.created_by
       WHERE t.farm_id=$1
       ORDER BY t.transfer_date DESC,t.created_at DESC,t.id DESC`,
      [farmId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      sourceUnitId: row.source_unit_id,
      sourceUnitName: row.source_unit_name,
      targetUnitId: row.target_unit_id,
      targetUnitName: row.target_unit_name,
      quantityLiters: row.quantity_liters,
      transferDate: row.transfer_date,
      note: row.note,
      createdByName: row.created_by_name,
      createdAt: row.created_at,
    }));
  });
}

export async function listCircularFeedLots(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<CircularFeedLotOption[]> {
  return db.transaction(async (tx) => {
    const member = await tx.query<{ id: string }>(
      `SELECT f.id FROM farm f
       JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2
       WHERE f.id=$1 AND f.archived_at IS NULL`,
      [farmId, actorId],
    );
    if (!member.rows[0]) throw new DomainError("FORBIDDEN");
    const result = await tx.query<{
      lot_id: string;
      item_id: string;
      item_name: string;
      label: string;
      unit: CircularFeedLotOption["unit"];
      quantity: string;
    }>(
      `SELECT l.id AS lot_id,i.id AS item_id,i.name AS item_name,l.label,i.unit,
         COALESCE(sum(m.quantity_delta),0)::numeric(18,3)::text AS quantity
       FROM inventory_lot l
       JOIN inventory_item i ON i.farm_id=l.farm_id AND i.id=l.inventory_item_id
       LEFT JOIN inventory_movement m ON m.farm_id=l.farm_id AND m.lot_id=l.id
       WHERE l.farm_id=$1 AND i.active AND i.category='FEED'
       GROUP BY l.id,i.id,i.name,l.label,i.unit
       ORDER BY i.name,l.label,l.id`,
      [farmId],
    );
    return result.rows.map((row) => ({
      lotId: row.lot_id,
      itemId: row.item_id,
      itemName: row.item_name,
      label: row.label,
      unit: row.unit,
      quantity: row.quantity,
    }));
  });
}

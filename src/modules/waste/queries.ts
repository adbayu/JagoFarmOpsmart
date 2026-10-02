import type { Database, Sql } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import type {
  WasteDetail,
  WasteHistoryEntry,
  WasteStatus,
  WasteSummary,
} from "./contracts.js";

type WasteRow = {
  id: string;
  source: string;
  quantity: string;
  unit: WasteSummary["unit"];
  waste_date: string;
  status: WasteStatus;
  usage: string | null;
  notes: string | null;
  created_by: string;
  created_by_name: string;
  updated_at: string;
};
const selectWaste = `SELECT w.id,w.source,w.quantity::text AS quantity,w.unit,
  w.waste_date::text AS waste_date,w.status,w.usage,w.notes,w.created_by,
  creator.display_name AS created_by_name,
  w.updated_at::text AS updated_at
  FROM waste_record w JOIN app_user creator ON creator.id=w.created_by`;

function summary(row: WasteRow): WasteSummary {
  return {
    id: row.id,
    source: row.source,
    quantity: row.quantity,
    unit: row.unit,
    wasteDate: row.waste_date,
    status: row.status,
    usage: row.usage,
    notes: row.notes,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    updatedAt: row.updated_at,
  };
}

async function assertFarmOwner(tx: Sql, actorId: string, farmId: string) {
  const farm = await tx.query<{ id: string }>(
    "SELECT f.id FROM farm f JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2 WHERE f.id=$1 AND f.archived_at IS NULL",
    [farmId, actorId],
  );
  if (!farm.rows[0]) throw new DomainError("FORBIDDEN");
}

export async function getWasteRecordInTransaction(
  tx: Sql,
  farmId: string,
  wasteId: string,
): Promise<WasteDetail> {
  const result = await tx.query<WasteRow>(
    `${selectWaste} WHERE w.farm_id=$1 AND w.id=$2`,
    [farmId, wasteId],
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("NOT_FOUND");
  const history = await tx.query<{
    from_status: WasteStatus | null;
    to_status: WasteStatus;
    reason: string | null;
    changed_by: string;
    changed_by_name: string;
    changed_at: string;
  }>(
    `SELECT e.from_status,e.to_status,e.reason,e.changed_by,
       actor.display_name AS changed_by_name,
       e.changed_at::text AS changed_at
     FROM waste_status_event e
     JOIN app_user actor ON actor.id=e.changed_by
     WHERE e.farm_id=$1 AND e.waste_id=$2
     ORDER BY e.sequence_no`,
    [farmId, wasteId],
  );
  return {
    ...summary(row),
    history: history.rows.map((entry): WasteHistoryEntry => ({
      fromStatus: entry.from_status,
      toStatus: entry.to_status,
      reason: entry.reason,
      changedBy: entry.changed_by,
      changedByName: entry.changed_by_name,
      changedAt: entry.changed_at,
    })),
  };
}

export async function getWasteRecord(
  db: Database,
  actorId: string,
  farmId: string,
  wasteId: string,
): Promise<WasteDetail> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(wasteId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    return getWasteRecordInTransaction(tx, farmId, wasteId);
  });
}

export async function listWasteRecords(
  db: Database,
  actorId: string,
  farmId: string,
  limit = 50,
  offset = 0,
): Promise<WasteSummary[]> {
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
    const result = await tx.query<WasteRow>(
      `${selectWaste} WHERE w.farm_id=$1
       ORDER BY w.waste_date DESC,w.id DESC LIMIT $2 OFFSET $3`,
      [farmId, limit, offset],
    );
    return result.rows.map(summary);
  });
}

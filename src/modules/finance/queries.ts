import type { Database, Sql } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import type { CostSummary, CostActivityOption } from "./contracts.js";

type CostRow = {
  id: string;
  cycle_id: string | null;
  cycle_name: string | null;
  activity_id: string | null;
  inventory_movement_id: string | null;
  movement_type: string | null;
  source_key: string;
  category: string;
  treatment: CostSummary["treatment"];
  amount_minor: string;
  cost_date: string;
  notes: string | null;
  status: CostSummary["status"];
  correction_of: string | null;
  cancel_reason: string | null;
  created_at: string;
};
const selectCost = `SELECT e.id,e.cycle_id,c.name AS cycle_name,e.activity_id,
  e.inventory_movement_id,m.type AS movement_type,e.source_key,e.category,
  e.treatment,e.amount_minor::text AS amount_minor,e.cost_date::text AS cost_date,
  e.notes,e.status,e.correction_of,e.cancel_reason,e.created_at::text AS created_at
  FROM cost_entry e
  LEFT JOIN farming_cycle c ON c.farm_id=e.farm_id AND c.id=e.cycle_id
  LEFT JOIN inventory_movement m ON m.farm_id=e.farm_id AND m.id=e.inventory_movement_id`;
function summary(row: CostRow): CostSummary {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    cycleName: row.cycle_name,
    activityId: row.activity_id,
    inventoryMovementId: row.inventory_movement_id,
    movementType: row.movement_type,
    sourceKey: row.source_key,
    category: row.category,
    treatment: row.treatment,
    amountMinor: row.amount_minor,
    costDate: row.cost_date,
    notes: row.notes,
    status: row.status,
    correctionOf: row.correction_of,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
  };
}
async function assertFarmOwner(tx: Sql, actorId: string, farmId: string) {
  const farm = await tx.query<{ id: string }>(
    "SELECT f.id FROM farm f JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2 WHERE f.id=$1 AND f.archived_at IS NULL",
    [farmId, actorId],
  );
  if (!farm.rows[0]) throw new DomainError("FORBIDDEN");
}
export async function getCostInTransaction(
  tx: Sql,
  farmId: string,
  costId: string,
): Promise<CostSummary> {
  const result = await tx.query<CostRow>(
    `${selectCost} WHERE e.farm_id=$1 AND e.id=$2`,
    [farmId, costId],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND");
  return summary(result.rows[0]);
}
export async function getCost(
  db: Database,
  actorId: string,
  farmId: string,
  costId: string,
) {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(costId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    return getCostInTransaction(tx, farmId, costId);
  });
}
export async function listCosts(
  db: Database,
  actorId: string,
  farmId: string,
  limit = 50,
  offset = 0,
): Promise<{ costs: CostSummary[]; nextOffset: number | null }> {
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
    const result = await tx.query<CostRow>(
      `${selectCost} WHERE e.farm_id=$1 ORDER BY e.cost_date DESC,e.created_at DESC,e.id DESC LIMIT $2 OFFSET $3`,
      [farmId, limit + 1, offset],
    );
    return {
      costs: result.rows.slice(0, limit).map(summary),
      nextOffset: result.rows.length > limit ? offset + limit : null,
    };
  });
}
export async function listCostActivities(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<CostActivityOption[]> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    const result = await tx.query<{
      id: string;
      cycle_id: string;
      cycle_name: string;
      kind: string;
      scheduled_at: string;
    }>(
      `SELECT a.id,a.cycle_id,c.name AS cycle_name,a.kind,a.scheduled_at::text AS scheduled_at
       FROM activity a JOIN farming_cycle c ON c.farm_id=a.farm_id AND c.id=a.cycle_id
       WHERE a.farm_id=$1 ORDER BY a.scheduled_at DESC,a.id DESC`,
      [farmId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      cycleId: row.cycle_id,
      cycleName: row.cycle_name,
      kind: row.kind,
      scheduledAt: row.scheduled_at,
    }));
  });
}

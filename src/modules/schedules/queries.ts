import { z } from "zod";
import type { Database, Sql } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import type { ActivitySummary } from "./contracts.js";

type ActivityRow = {
  id: string;
  cycle_id: string;
  cycle_name: string;
  farming_type: ActivitySummary["type"];
  kind: ActivitySummary["kind"];
  status: ActivitySummary["status"];
  scheduled_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  notes: string | null;
};
const selectActivity = `SELECT a.id,a.cycle_id,c.name AS cycle_name,c.farming_type,
  a.kind,a.status,a.scheduled_at::text AS scheduled_at,
  a.completed_at::text AS completed_at,a.cancelled_at::text AS cancelled_at,a.notes
  FROM activity a JOIN farming_cycle c ON c.farm_id=a.farm_id AND c.id=a.cycle_id`;
function summary(row: ActivityRow): ActivitySummary {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    cycleName: row.cycle_name,
    type: row.farming_type,
    kind: row.kind,
    status: row.status,
    scheduledAt: row.scheduled_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    notes: row.notes,
  };
}
async function assertFarmOwner(tx: Sql, actorId: string, farmId: string) {
  const farm = await tx.query<{ id: string }>(
    "SELECT f.id FROM farm f JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2 WHERE f.id=$1 AND f.archived_at IS NULL",
    [farmId, actorId],
  );
  if (!farm.rows[0]) throw new DomainError("FORBIDDEN");
}
export async function getActivityInTransaction(
  tx: Sql,
  farmId: string,
  activityId: string,
): Promise<ActivitySummary> {
  const result = await tx.query<ActivityRow>(
    `${selectActivity} WHERE a.farm_id=$1 AND a.id=$2`,
    [farmId, activityId],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND");
  return summary(result.rows[0]);
}
export async function getActivity(
  db: Database,
  actorId: string,
  farmId: string,
  activityId: string,
): Promise<ActivitySummary> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(activityId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    return getActivityInTransaction(tx, farmId, activityId);
  });
}
export async function listActivities(
  db: Database,
  actorId: string,
  farmId: string,
  from: string,
  to: string,
): Promise<ActivitySummary[]> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  z.iso.datetime({ offset: true }).parse(from);
  z.iso.datetime({ offset: true }).parse(to);
  if (Date.parse(from) >= Date.parse(to)) throw new DomainError("VALIDATION");
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    const result = await tx.query<ActivityRow>(
      `${selectActivity} WHERE a.farm_id=$1
       AND a.scheduled_at >= $2::timestamptz AND a.scheduled_at < $3::timestamptz
       ORDER BY a.scheduled_at,a.id`,
      [farmId, from, to],
    );
    return result.rows.map(summary);
  });
}

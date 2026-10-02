import { randomUUID } from "node:crypto";
import type { Database } from "../../server/db.js";
import { command } from "../../server/command.js";
import type {
  ActivityStatus,
  CommandContext,
  CycleStatus,
} from "../../shared/domain.js";
import { DomainError } from "../../shared/errors.js";
import { assertActivityTransition } from "../farming/states.js";
import {
  createActivityInput,
  transitionActivityInput,
  type ActivitySummary,
} from "./contracts.js";
import { getActivityInTransaction } from "./queries.js";

export async function createActivity(
  db: Database,
  context: CommandContext,
  raw: unknown,
): Promise<{ activityId: string }> {
  const input = createActivityInput.parse(raw);
  return command(
    db,
    context,
    "schedules.createActivity",
    input.idempotencyKey,
    input,
    async (tx) => {
      const cycle = await tx.query<{ status: CycleStatus }>(
        "SELECT status FROM farming_cycle WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, input.cycleId],
      );
      if (!cycle.rows[0]) throw new DomainError("NOT_FOUND");
      if (cycle.rows[0].status !== "ACTIVE") throw new DomainError("CONFLICT");
      const activityId = randomUUID();
      await tx.query(
        `INSERT INTO activity
         (id,farm_id,cycle_id,kind,status,scheduled_at,notes,created_by)
         VALUES($1,$2,$3,$4,'SCHEDULED',$5,$6,$7)`,
        [
          activityId,
          context.farmId,
          input.cycleId,
          input.kind,
          input.scheduledAt,
          input.notes ?? null,
          context.actorId,
        ],
      );
      return { activityId };
    },
  );
}

export async function transitionActivity(
  db: Database,
  context: CommandContext,
  raw: unknown,
): Promise<ActivitySummary> {
  const input = transitionActivityInput.parse(raw);
  return command(
    db,
    context,
    "schedules.transitionActivity",
    input.idempotencyKey,
    input,
    async (tx) => {
      const activity = await tx.query<{
        status: ActivityStatus;
        cycle_id: string;
      }>(
        "SELECT status,cycle_id FROM activity WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, input.activityId],
      );
      const current = activity.rows[0];
      if (!current) throw new DomainError("NOT_FOUND");
      if (current.status !== input.expectedStatus)
        throw new DomainError("CONFLICT");
      assertActivityTransition(current.status, input.status);
      const cycle = await tx.query<{ status: CycleStatus }>(
        "SELECT status FROM farming_cycle WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, current.cycle_id],
      );
      if (!cycle.rows[0]) throw new DomainError("CONFLICT");
      if (input.status !== "CANCELLED" && cycle.rows[0].status !== "ACTIVE")
        throw new DomainError("CONFLICT");
      await tx.query(
        `UPDATE activity SET status=$3::activity_status,updated_at=now(),
         completed_at=CASE WHEN $3::activity_status='COMPLETED' THEN now() ELSE completed_at END,
         cancelled_at=CASE WHEN $3::activity_status='CANCELLED' THEN now() ELSE cancelled_at END,
         cancelled_by=CASE WHEN $3::activity_status='CANCELLED' THEN $4::uuid ELSE cancelled_by END
         WHERE farm_id=$1 AND id=$2`,
        [context.farmId, input.activityId, input.status, context.actorId],
      );
      return getActivityInTransaction(tx, context.farmId, input.activityId);
    },
  );
}

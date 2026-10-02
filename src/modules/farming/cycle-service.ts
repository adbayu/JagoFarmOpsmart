import { randomUUID } from "node:crypto";
import type { Database } from "../../server/db.js";
import { command } from "../../server/command.js";
import type { CommandContext, CycleStatus } from "../../shared/domain.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import {
  createCommodityInput,
  createCycleInput,
  createObservationInput,
  transitionCycleInput,
  type CommoditySummary,
  type CycleDetail,
} from "./contracts.js";
import { getCycleInTransaction } from "./cycle-queries.js";
import { getUnitInTransaction } from "./queries.js";
import { assertCycleTransition } from "./states.js";

export async function createCommodity(
  db: Database,
  context: CommandContext,
  raw: unknown,
): Promise<CommoditySummary> {
  const input = createCommodityInput.parse(raw);
  return command(
    db,
    context,
    "farming.createCommodity",
    input.idempotencyKey,
    input,
    async (tx) => {
      const id = randomUUID();
      await tx.query(
        "INSERT INTO commodity(id,farm_id,name,farming_type) VALUES($1,$2,$3,$4)",
        [id, context.farmId, input.name, input.type],
      );
      return { id, type: input.type, name: input.name };
    },
  );
}

export async function createCycle(
  db: Database,
  context: CommandContext,
  raw: unknown,
): Promise<{ cycleId: string }> {
  const input = createCycleInput.parse(raw);
  return command(
    db,
    context,
    "farming.createCycle",
    input.idempotencyKey,
    input,
    async (tx) => {
      const unit = await getUnitInTransaction(tx, context.farmId, input.unitId);
      if (!unit.active || unit.type !== input.type)
        throw new DomainError("CONFLICT");
      const commodity = await tx.query<{ id: string }>(
        "SELECT id FROM commodity WHERE farm_id=$1 AND id=$2 AND farming_type=$3",
        [context.farmId, input.commodityId, input.type],
      );
      if (!commodity.rows[0]) throw new DomainError("NOT_FOUND");
      const cycleId = randomUUID();
      await tx.query(
        `INSERT INTO farming_cycle
         (id,farm_id,unit_id,commodity_id,farming_type,name,status,
          start_date,target_harvest_date,created_by)
         VALUES($1,$2,$3,$4,$5,$6,'PLANNED',$7,$8,$9)`,
        [
          cycleId,
          context.farmId,
          input.unitId,
          input.commodityId,
          input.type,
          input.name,
          input.startDate,
          input.targetHarvestDate ?? null,
          context.actorId,
        ],
      );
      if (input.type === "FISH")
        await tx.query(
          `INSERT INTO fish_cycle
           (cycle_id,farm_id,initial_population,seed_source,initial_weight_g)
           VALUES($1,$2,$3,$4,$5)`,
          [
            cycleId,
            context.farmId,
            input.initialPopulation,
            input.seedSource ?? null,
            input.initialWeightG ?? null,
          ],
        );
      else if (input.type === "CHICKEN")
        await tx.query(
          `INSERT INTO chicken_cycle
           (cycle_id,farm_id,initial_population,strain,initial_age_days,seed_source)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [
            cycleId,
            context.farmId,
            input.initialPopulation,
            input.strain ?? null,
            input.initialAgeDays ?? null,
            input.seedSource ?? null,
          ],
        );
      else
        await tx.query(
          `INSERT INTO crop_cycle
           (cycle_id,farm_id,seed_count,variety,seedling_date)
           VALUES($1,$2,$3,$4,$5)`,
          [
            cycleId,
            context.farmId,
            input.seedCount,
            input.variety ?? null,
            input.seedlingDate ?? null,
          ],
        );
      return { cycleId };
    },
  );
}

export async function transitionCycle(
  db: Database,
  context: CommandContext,
  cycleId: string,
  raw: unknown,
): Promise<CycleDetail> {
  uuid.parse(cycleId);
  const input = transitionCycleInput.parse(raw);
  return command(
    db,
    context,
    "farming.transitionCycle",
    input.idempotencyKey,
    { cycleId, ...input },
    async (tx) => {
      const locked = await tx.query<{
        status: CycleStatus;
        unit_id: string;
      }>(
        "SELECT status,unit_id FROM farming_cycle WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, cycleId],
      );
      const current = locked.rows[0];
      if (!current) throw new DomainError("NOT_FOUND");
      if (current.status !== input.expectedStatus)
        throw new DomainError("CONFLICT");
      assertCycleTransition(current.status, input.status);
      // Reading the typed detail also rejects an incomplete parent/subtype pair.
      const detail = await getCycleInTransaction(tx, context.farmId, cycleId);
      if (input.status === "ACTIVE") {
        const unit = await getUnitInTransaction(
          tx,
          context.farmId,
          current.unit_id,
        );
        if (!unit.active || unit.type !== detail.type)
          throw new DomainError("CONFLICT");
        const unitTable = {
          FISH: "pond",
          CHICKEN: "coop",
          CROP: "growing_area",
        }[detail.type];
        const subtype = await tx.query<{ unit_id: string }>(
          `SELECT unit_id FROM ${unitTable} WHERE farm_id=$1 AND unit_id=$2`,
          [context.farmId, unit.id],
        );
        if (!subtype.rows[0]) throw new DomainError("CONFLICT");
      }
      if (input.status === "COMPLETED") {
        const open = await tx.query<{ id: string }>(
          `SELECT id FROM activity WHERE farm_id=$1 AND cycle_id=$2
           AND status NOT IN ('COMPLETED','CANCELLED') LIMIT 1`,
          [context.farmId, cycleId],
        );
        if (open.rows[0]) throw new DomainError("CONFLICT");
      }
      await tx.query(
        `UPDATE farming_cycle SET status=$3::cycle_status,updated_at=now(),
         ended_at=CASE WHEN $3::cycle_status='COMPLETED' THEN now() ELSE ended_at END,
         cancelled_at=CASE WHEN $3::cycle_status='CANCELLED' THEN now() ELSE cancelled_at END,
         cancelled_by=CASE WHEN $3::cycle_status='CANCELLED' THEN $4::uuid ELSE cancelled_by END
         WHERE farm_id=$1 AND id=$2`,
        [context.farmId, cycleId, input.status, context.actorId],
      );
      return getCycleInTransaction(tx, context.farmId, cycleId);
    },
  );
}

export async function recordObservation(
  db: Database,
  context: CommandContext,
  cycleId: string,
  raw: unknown,
): Promise<{ observationId: string }> {
  uuid.parse(cycleId);
  const input = createObservationInput.parse(raw);
  return command(
    db,
    context,
    "farming.recordObservation",
    input.idempotencyKey,
    { cycleId, ...input },
    async (tx) => {
      const cycle = await tx.query<{ status: CycleStatus }>(
        "SELECT status FROM farming_cycle WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, cycleId],
      );
      if (!cycle.rows[0]) throw new DomainError("NOT_FOUND");
      if (cycle.rows[0].status !== "ACTIVE") throw new DomainError("CONFLICT");
      const observationId = randomUUID();
      await tx.query(
        `INSERT INTO cycle_observation
         (id,farm_id,cycle_id,actor_id,observed_at,population_loss,
          average_weight_g,condition_notes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          observationId,
          context.farmId,
          cycleId,
          context.actorId,
          input.observedAt,
          input.populationLoss ?? null,
          input.averageWeightG ?? null,
          input.conditionNotes ?? null,
        ],
      );
      return { observationId };
    },
  );
}

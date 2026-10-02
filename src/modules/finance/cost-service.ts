import { randomUUID } from "node:crypto";
import type { Database, Sql } from "../../server/db.js";
import { command } from "../../server/command.js";
import type { CommandContext } from "../../shared/domain.js";
import { assertMoneyRange } from "../../shared/decimal.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import {
  cancelCostInput,
  correctCostInput,
  recordCostInput,
} from "./contracts.js";
import { getCostInTransaction } from "./queries.js";
import { financePolicyVersion } from "./policy.js";

type CostInput = ReturnType<typeof recordCostInput.parse>;
async function validateReferences(tx: Sql, farmId: string, input: CostInput) {
  if (input.cycleId) {
    const cycle = await tx.query<{ id: string }>(
      "SELECT id FROM farming_cycle WHERE farm_id=$1 AND id=$2",
      [farmId, input.cycleId],
    );
    if (!cycle.rows[0]) throw new DomainError("NOT_FOUND");
  }
  if (input.activityId) {
    const activity = await tx.query<{ id: string }>(
      "SELECT id FROM activity WHERE farm_id=$1 AND id=$2 AND cycle_id=$3",
      [farmId, input.activityId, input.cycleId],
    );
    if (!activity.rows[0]) throw new DomainError("CONFLICT");
  }
  if (input.inventoryMovementId) {
    const movement = await tx.query<{
      type: string;
      consumption_id: string | null;
      harvest_output_id: string | null;
    }>(
      `SELECT m.type,m.consumption_id,l.harvest_output_id
       FROM inventory_movement m JOIN inventory_lot l
       ON l.farm_id=m.farm_id AND l.id=m.lot_id
       WHERE m.farm_id=$1 AND m.id=$2`,
      [farmId, input.inventoryMovementId],
    );
    const source = movement.rows[0];
    if (!source) throw new DomainError("NOT_FOUND");
    if (source.type === "STOCK_IN") {
      if (
        source.harvest_output_id ||
        input.cycleId ||
        input.activityId ||
        input.treatment === "PRODUCTION"
      )
        throw new DomainError("CONFLICT");
    } else if (source.type === "CONSUMPTION" && source.consumption_id) {
      const consumption = await tx.query<{
        cycle_id: string;
        activity_id: string;
      }>(
        "SELECT cycle_id,activity_id FROM consumption WHERE farm_id=$1 AND id=$2",
        [farmId, source.consumption_id],
      );
      if (
        consumption.rows[0]?.cycle_id !== input.cycleId ||
        consumption.rows[0]?.activity_id !== input.activityId ||
        input.treatment === "INVENTORY_PURCHASE"
      )
        throw new DomainError("CONFLICT");
    } else throw new DomainError("CONFLICT");
  } else if (input.treatment === "INVENTORY_PURCHASE") {
    throw new DomainError("VALIDATION");
  }
}
async function insertCost(
  tx: Sql,
  context: CommandContext,
  input: CostInput,
  correctionOf: string | null,
) {
  await validateReferences(tx, context.farmId, input);
  const id = randomUUID();
  await tx.query(
    `INSERT INTO cost_entry(id,farm_id,cycle_id,activity_id,inventory_movement_id,
     source_key,category,treatment,amount_minor,cost_date,notes,created_by,correction_of,policy_version)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      id,
      context.farmId,
      input.cycleId ?? null,
      input.activityId ?? null,
      input.inventoryMovementId ?? null,
      input.sourceKey,
      input.category,
      input.treatment,
      input.amountMinor,
      input.costDate,
      input.notes ?? null,
      context.actorId,
      correctionOf,
      input.treatment === "PRODUCTION" ? financePolicyVersion : null,
    ],
  );
  return getCostInTransaction(tx, context.farmId, id);
}
export async function recordCost(
  db: Database,
  context: CommandContext,
  raw: unknown,
) {
  const input = recordCostInput.parse(raw);
  assertMoneyRange(BigInt(input.amountMinor));
  return command(
    db,
    context,
    "finance.recordCost",
    input.idempotencyKey,
    input,
    (tx) => insertCost(tx, context, input, null),
  );
}
export async function correctCost(
  db: Database,
  context: CommandContext,
  costId: string,
  raw: unknown,
) {
  uuid.parse(costId);
  const input = correctCostInput.parse(raw);
  assertMoneyRange(BigInt(input.amountMinor));
  return command(
    db,
    context,
    "finance.correctCost",
    input.idempotencyKey,
    { costId, ...input },
    async (tx) => {
      const existing = await tx.query<{ status: string }>(
        "SELECT status FROM cost_entry WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, costId],
      );
      if (!existing.rows[0]) throw new DomainError("NOT_FOUND");
      if (existing.rows[0].status !== "POSTED")
        throw new DomainError("CONFLICT");
      await tx.query(
        `UPDATE cost_entry SET status='CANCELLED',cancelled_at=now(),cancelled_by=$3,
       cancel_reason=$4,updated_at=now() WHERE farm_id=$1 AND id=$2`,
        [context.farmId, costId, context.actorId, input.correctionReason],
      );
      return insertCost(tx, context, input, costId);
    },
  );
}
export async function cancelCost(
  db: Database,
  context: CommandContext,
  costId: string,
  raw: unknown,
) {
  uuid.parse(costId);
  const input = cancelCostInput.parse(raw);
  return command(
    db,
    context,
    "finance.cancelCost",
    input.idempotencyKey,
    { costId, ...input },
    async (tx) => {
      const existing = await tx.query<{ status: string }>(
        "SELECT status FROM cost_entry WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, costId],
      );
      if (!existing.rows[0]) throw new DomainError("NOT_FOUND");
      if (existing.rows[0].status !== "POSTED")
        throw new DomainError("CONFLICT");
      await tx.query(
        `UPDATE cost_entry SET status='CANCELLED',cancelled_at=now(),cancelled_by=$3,
       cancel_reason=$4,updated_at=now() WHERE farm_id=$1 AND id=$2`,
        [context.farmId, costId, context.actorId, input.reason],
      );
      return getCostInTransaction(tx, context.farmId, costId);
    },
  );
}

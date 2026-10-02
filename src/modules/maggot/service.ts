import { randomUUID } from "node:crypto";
import type { Database, Sql } from "../../server/db.js";
import { command } from "../../server/command.js";
import type { CommandContext, Unit } from "../../shared/domain.js";
import { decimal, scaled, validateUnitQuantity } from "../../shared/decimal.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import {
  addMaggotBatchInputInput,
  addMaggotObservationInput,
  completeMaggotBatchInput,
  createMaggotBatchInput,
  recordMaggotOutputInput,
  recordMaggotOutputUseInput,
} from "./contracts.js";

async function openBatch(tx: Sql, farmId: string, batchId: string) {
  const result = await tx.query<{ id: string; status: string }>(
    "SELECT id,status FROM maggot_batch WHERE farm_id=$1 AND id=$2 FOR UPDATE",
    [farmId, batchId],
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("NOT_FOUND");
  if (row.status !== "OPEN") throw new DomainError("CONFLICT");
}

export async function createMaggotBatch(
  db: Database,
  context: CommandContext,
  raw: unknown,
): Promise<{ batchId: string }> {
  const input = createMaggotBatchInput.parse(raw);
  return command(
    db,
    context,
    "maggot.createBatch",
    input.idempotencyKey,
    input,
    async (tx) => {
      const batchId = randomUUID();
      await tx.query(
        `INSERT INTO maggot_batch
         (id,farm_id,started_on,media,notes,created_by)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [
          batchId,
          context.farmId,
          input.startedOn,
          input.media,
          input.notes ?? null,
          context.actorId,
        ],
      );
      return { batchId };
    },
  );
}

export async function addMaggotBatchInput(
  db: Database,
  context: CommandContext,
  batchId: string,
  raw: unknown,
): Promise<{ inputId: string; quantity: string; unit: Unit }> {
  uuid.parse(batchId);
  const input = addMaggotBatchInputInput.parse(raw);
  return command(
    db,
    context,
    "maggot.addBatchInput",
    input.idempotencyKey,
    { batchId, ...input },
    async (tx) => {
      await openBatch(tx, context.farmId, batchId);
      const waste = await tx.query<{
        status: string;
        quantity: string;
        unit: Unit;
      }>(
        `SELECT status,quantity::text,unit FROM waste_record
         WHERE farm_id=$1 AND id=$2 FOR UPDATE`,
        [context.farmId, input.wasteId],
      );
      const source = waste.rows[0];
      if (!source) throw new DomainError("NOT_FOUND");
      if (source.status === "REUSED" || source.status === "DISPOSED")
        throw new DomainError("CONFLICT");
      validateUnitQuantity(scaled(input.quantity), source.unit);
      const existing = await tx.query<{ quantity: string }>(
        `SELECT COALESCE(sum(quantity),0)::text AS quantity
         FROM maggot_batch_input WHERE farm_id=$1 AND waste_id=$2`,
        [context.farmId, input.wasteId],
      );
      const available =
        scaled(source.quantity) - scaled(existing.rows[0]!.quantity);
      const amount = scaled(input.quantity);
      if (available < amount) throw new DomainError("CONFLICT");
      const inputId = randomUUID();
      await tx.query(
        `INSERT INTO maggot_batch_input
         (id,farm_id,batch_id,waste_id,quantity,unit,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          inputId,
          context.farmId,
          batchId,
          input.wasteId,
          decimal(amount),
          source.unit,
          context.actorId,
        ],
      );
      return { inputId, quantity: decimal(amount), unit: source.unit };
    },
  );
}

export async function addMaggotObservation(
  db: Database,
  context: CommandContext,
  batchId: string,
  raw: unknown,
): Promise<{ observationId: string }> {
  uuid.parse(batchId);
  const input = addMaggotObservationInput.parse(raw);
  return command(
    db,
    context,
    "maggot.addObservation",
    input.idempotencyKey,
    { batchId, ...input },
    async (tx) => {
      await openBatch(tx, context.farmId, batchId);
      const observationId = randomUUID();
      await tx.query(
        `INSERT INTO maggot_batch_observation
         (id,farm_id,batch_id,observed_at,observation,created_by)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [
          observationId,
          context.farmId,
          batchId,
          input.observedAt,
          input.observation,
          context.actorId,
        ],
      );
      return { observationId };
    },
  );
}

export async function recordMaggotOutput(
  db: Database,
  context: CommandContext,
  batchId: string,
  raw: unknown,
): Promise<{ outputId: string }> {
  uuid.parse(batchId);
  const input = recordMaggotOutputInput.parse(raw);
  validateUnitQuantity(scaled(input.quantity), input.unit);
  return command(
    db,
    context,
    "maggot.recordOutput",
    input.idempotencyKey,
    { batchId, ...input },
    async (tx) => {
      await openBatch(tx, context.farmId, batchId);
      const outputId = randomUUID();
      await tx.query(
        `INSERT INTO maggot_batch_output
         (id,farm_id,batch_id,harvested_at,quantity,unit,notes,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          outputId,
          context.farmId,
          batchId,
          input.harvestedAt,
          input.quantity,
          input.unit,
          input.notes ?? null,
          context.actorId,
        ],
      );
      return { outputId };
    },
  );
}

export async function recordMaggotOutputUse(
  db: Database,
  context: CommandContext,
  batchId: string,
  outputId: string,
  raw: unknown,
): Promise<{ useId: string }> {
  uuid.parse(batchId);
  uuid.parse(outputId);
  const input = recordMaggotOutputUseInput.parse(raw);
  return command(
    db,
    context,
    "maggot.recordOutputUse",
    input.idempotencyKey,
    { batchId, outputId, ...input },
    async (tx) => {
      await openBatch(tx, context.farmId, batchId);
      const output = await tx.query<{ quantity: string; unit: Unit }>(
        `SELECT quantity::text,unit FROM maggot_batch_output
         WHERE farm_id=$1 AND batch_id=$2 AND id=$3 FOR UPDATE`,
        [context.farmId, batchId, outputId],
      );
      const row = output.rows[0];
      if (!row) throw new DomainError("NOT_FOUND");
      const amount = scaled(input.quantity);
      validateUnitQuantity(amount, row.unit);
      const used = await tx.query<{ quantity: string }>(
        `SELECT COALESCE(sum(quantity),0)::text AS quantity
         FROM maggot_batch_output_use
         WHERE farm_id=$1 AND batch_id=$2 AND output_id=$3`,
        [context.farmId, batchId, outputId],
      );
      if (scaled(row.quantity) - scaled(used.rows[0]!.quantity) < amount)
        throw new DomainError("CONFLICT");
      const useId = randomUUID();
      await tx.query(
        `INSERT INTO maggot_batch_output_use
         (id,farm_id,batch_id,output_id,quantity,purpose,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          useId,
          context.farmId,
          batchId,
          outputId,
          decimal(amount),
          input.purpose,
          context.actorId,
        ],
      );
      return { useId };
    },
  );
}

export async function completeMaggotBatch(
  db: Database,
  context: CommandContext,
  batchId: string,
  raw: unknown,
): Promise<{ batchId: string; status: "COMPLETED" }> {
  uuid.parse(batchId);
  const input = completeMaggotBatchInput.parse(raw);
  return command(
    db,
    context,
    "maggot.completeBatch",
    input.idempotencyKey,
    { batchId, ...input },
    async (tx) => {
      await openBatch(tx, context.farmId, batchId);
      const inputs = await tx.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM maggot_batch_input WHERE farm_id=$1 AND batch_id=$2",
        [context.farmId, batchId],
      );
      if (Number(inputs.rows[0]?.count ?? 0) === 0)
        throw new DomainError("CONFLICT");
      await tx.query(
        `UPDATE maggot_batch SET status='COMPLETED',completion_note=$3,
         completed_by=$4,completed_at=now() WHERE farm_id=$1 AND id=$2`,
        [context.farmId, batchId, input.completionNote, context.actorId],
      );
      return { batchId, status: "COMPLETED" };
    },
  );
}

import { randomUUID } from "node:crypto";
import type { Database } from "../../server/db.js";
import { command } from "../../server/command.js";
import type { CommandContext } from "../../shared/domain.js";
import { scaled, validateUnitQuantity } from "../../shared/decimal.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import {
  createWasteRecordInput,
  transitionWasteRecordInput,
  type WasteStatus,
} from "./contracts.js";
import { getWasteRecordInTransaction } from "./queries.js";

const transitions: Record<WasteStatus, WasteStatus[]> = {
  RECORDED: ["PROCESSING", "PROCESSED", "DISPOSED"],
  PROCESSING: ["PROCESSED", "DISPOSED"],
  PROCESSED: ["REUSED", "DISPOSED"],
  REUSED: [],
  DISPOSED: [],
};

export async function createWasteRecord(
  db: Database,
  context: CommandContext,
  raw: unknown,
): Promise<{ wasteId: string }> {
  const input = createWasteRecordInput.parse(raw);
  validateUnitQuantity(scaled(input.quantity), input.unit);
  return command(
    db,
    context,
    "waste.createRecord",
    input.idempotencyKey,
    input,
    async (tx) => {
      const wasteId = randomUUID();
      await tx.query(
        `INSERT INTO waste_record
         (id,farm_id,source,quantity,unit,waste_date,notes,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
        [
          wasteId,
          context.farmId,
          input.source,
          input.quantity,
          input.unit,
          input.wasteDate,
          input.notes ?? null,
          context.actorId,
        ],
      );
      await tx.query(
        `INSERT INTO waste_status_event
         (id,farm_id,waste_id,from_status,to_status,sequence_no,changed_by)
         VALUES($1,$2,$3,NULL,'RECORDED',1,$4)`,
        [randomUUID(), context.farmId, wasteId, context.actorId],
      );
      return { wasteId };
    },
  );
}

export async function transitionWasteRecord(
  db: Database,
  context: CommandContext,
  wasteId: string,
  raw: unknown,
) {
  uuid.parse(wasteId);
  const input = transitionWasteRecordInput.parse(raw);
  return command(
    db,
    context,
    "waste.transitionRecord",
    input.idempotencyKey,
    { wasteId, ...input },
    async (tx) => {
      const result = await tx.query<{
        status: WasteStatus;
        usage: string | null;
      }>(
        "SELECT status,usage FROM waste_record WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, wasteId],
      );
      const current = result.rows[0];
      if (!current) throw new DomainError("NOT_FOUND");
      if (current.status !== input.expectedStatus)
        throw new DomainError("CONFLICT");
      if (!transitions[current.status].includes(input.status))
        throw new DomainError("CONFLICT");
      if (input.status === "REUSED" && !input.usage)
        throw new DomainError("CONFLICT");

      const sequence = await tx.query<{ next_sequence: string }>(
        `SELECT (COALESCE(max(sequence_no),0)+1)::text AS next_sequence
         FROM waste_status_event WHERE farm_id=$1 AND waste_id=$2`,
        [context.farmId, wasteId],
      );
      await tx.query(
        `UPDATE waste_record SET status=$3,usage=COALESCE($4,usage),
           updated_by=$5,updated_at=now()
         WHERE farm_id=$1 AND id=$2`,
        [
          context.farmId,
          wasteId,
          input.status,
          input.usage ?? null,
          context.actorId,
        ],
      );
      await tx.query(
        `INSERT INTO waste_status_event
         (id,farm_id,waste_id,from_status,to_status,sequence_no,reason,changed_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          context.farmId,
          wasteId,
          current.status,
          input.status,
          Number(sequence.rows[0]?.next_sequence ?? 1),
          input.usage ?? null,
          context.actorId,
        ],
      );
      return getWasteRecordInTransaction(tx, context.farmId, wasteId);
    },
  );
}

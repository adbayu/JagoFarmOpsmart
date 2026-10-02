import { randomUUID } from "node:crypto";
import type { Database } from "../../server/db.js";
import { command } from "../../server/command.js";
import type { CommandContext, Unit } from "../../shared/domain.js";
import { decimal, scaled, validateUnitQuantity } from "../../shared/decimal.js";
import { DomainError } from "../../shared/errors.js";
import { stockInCircularFeedInTransaction } from "../inventory/movement-service.js";
import {
  postMaggotOutputInput,
  recordWaterTransferInput,
} from "./contracts.js";

export async function createWaterTransfer(
  db: Database,
  context: CommandContext,
  raw: unknown,
): Promise<{ transferId: string }> {
  const input = recordWaterTransferInput.parse(raw);
  return command(
    db,
    context,
    "circular.createWaterTransfer",
    input.idempotencyKey,
    input,
    async (tx) => {
      const units = await tx.query<{ id: string }>(
        `SELECT id FROM farm_unit
         WHERE farm_id=$1 AND active=true
           AND ((id=$2 AND farming_type='FISH')
             OR (id=$3 AND farming_type='CROP'))
         FOR SHARE`,
        [context.farmId, input.sourceUnitId, input.targetUnitId],
      );
      if (
        units.rows.length !== 2 ||
        !units.rows.some((unit) => unit.id === input.sourceUnitId) ||
        !units.rows.some((unit) => unit.id === input.targetUnitId)
      )
        throw new DomainError("NOT_FOUND");

      const transferId = randomUUID();
      await tx.query(
        `INSERT INTO circular_water_transfer
         (id,farm_id,source_unit_id,target_unit_id,quantity_liters,transfer_date,note,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          transferId,
          context.farmId,
          input.sourceUnitId,
          input.targetUnitId,
          decimal(scaled(input.quantityLiters)),
          input.transferDate,
          input.note || null,
          context.actorId,
        ],
      );
      return { transferId };
    },
  );
}

export async function postMaggotOutputToFeed(
  db: Database,
  context: CommandContext,
  raw: unknown,
): Promise<{ postingId: string; movementId: string }> {
  const input = postMaggotOutputInput.parse(raw);
  const amount = scaled(input.quantity);
  return command(
    db,
    context,
    "circular.postMaggotOutputToFeed",
    input.idempotencyKey,
    input,
    async (tx) => {
      const source = await tx.query<{
        status: string;
        quantity: string;
        unit: Unit;
      }>(
        `SELECT b.status,o.quantity::text,o.unit
         FROM maggot_batch b
         JOIN maggot_batch_output o
           ON o.farm_id=b.farm_id AND o.batch_id=b.id
         WHERE b.farm_id=$1 AND b.id=$2 AND o.id=$3
         FOR UPDATE OF b,o`,
        [context.farmId, input.batchId, input.outputId],
      );
      const output = source.rows[0];
      if (!output) throw new DomainError("NOT_FOUND");
      if (output.status !== "COMPLETED") throw new DomainError("CONFLICT");
      validateUnitQuantity(amount, output.unit);

      const used = await tx.query<{ quantity: string }>(
        `SELECT COALESCE(sum(quantity),0)::text AS quantity
         FROM maggot_batch_output_use
         WHERE farm_id=$1 AND batch_id=$2 AND output_id=$3`,
        [context.farmId, input.batchId, input.outputId],
      );
      const posted = await tx.query<{ quantity: string }>(
        `SELECT COALESCE(sum(quantity),0)::text AS quantity
         FROM circular_maggot_posting
         WHERE farm_id=$1 AND batch_id=$2 AND output_id=$3`,
        [context.farmId, input.batchId, input.outputId],
      );
      const remaining =
        scaled(output.quantity) -
        scaled(used.rows[0]!.quantity) -
        scaled(posted.rows[0]!.quantity);
      if (remaining < amount) throw new DomainError("CONFLICT");

      const movementId = await stockInCircularFeedInTransaction(
        tx,
        context,
        input.lotId,
        amount,
        output.unit,
        input.reason,
      );
      const postingId = randomUUID();
      await tx.query(
        `INSERT INTO circular_maggot_posting
         (id,farm_id,batch_id,output_id,movement_id,quantity,unit,reason,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          postingId,
          context.farmId,
          input.batchId,
          input.outputId,
          movementId,
          decimal(amount),
          output.unit,
          input.reason,
          context.actorId,
        ],
      );
      return { postingId, movementId };
    },
  );
}

import { createHash } from "node:crypto";
import type { CommandContext } from "../shared/domain.js";
import { DomainError } from "../shared/errors.js";
import { contextSchema } from "../shared/validation.js";
import type { Database, Sql } from "./db.js";

export function requestHash(actorId: string, parsedInput: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify({ actorId, input: parsedInput }))
    .digest("hex");
}

export async function command<T>(
  db: Database,
  context: CommandContext,
  operation: string,
  key: string,
  parsedInput: unknown,
  execute: (tx: Sql) => Promise<T>,
): Promise<T> {
  // Context is an internal structural type; validate its two authority fields explicitly.
  const { farmId, actorId } = contextSchema.parse({
    farmId: context.farmId,
    actorId: context.actorId,
  });
  const hash = requestHash(actorId, parsedInput);
  return db.transaction(async (tx) => {
    // ponytail: one lock per farm; use ordered per-lot locks if farm write contention is measured.
    const farm = await tx.query<{ archived_at: string | null }>(
      `SELECT f.id,f.archived_at FROM farm f
       JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2
       WHERE f.id=$1 FOR UPDATE OF f`,
      [farmId, actorId],
    );
    if (!farm.rows.length) throw new DomainError("FORBIDDEN");
    const receipt = await tx.query<{ request_hash: string; response: T }>(
      "SELECT request_hash,response FROM command_receipt WHERE farm_id=$1 AND operation=$2 AND idempotency_key=$3",
      [farmId, operation, key],
    );
    if (receipt.rows[0]) {
      if (receipt.rows[0].request_hash !== hash)
        throw new DomainError("CONFLICT");
      return receipt.rows[0].response;
    }
    if (farm.rows[0]?.archived_at) throw new DomainError("FORBIDDEN");
    const response = await execute(tx);
    await tx.query(
      "INSERT INTO command_receipt(farm_id,operation,idempotency_key,request_hash,response,created_by) VALUES($1,$2,$3,$4,$5,$6)",
      [farmId, operation, key, hash, JSON.stringify(response), actorId],
    );
    return response;
  });
}

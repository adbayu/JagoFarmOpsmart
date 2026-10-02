import type { Database } from "../../server/db.js";
import { command, requestHash } from "../../server/command.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import {
  archiveFarmInput,
  addFarmMemberInput,
  removeFarmMemberInput,
  createFarmInput,
  updateFarmInput,
  type FarmSummary,
} from "./contracts.js";
import { getFarmInTransaction } from "./queries.js";

export async function createFarm(
  db: Database,
  actorId: string,
  raw: unknown,
): Promise<FarmSummary> {
  uuid.parse(actorId);
  const input = createFarmInput.parse(raw);
  const hash = requestHash(actorId, input);
  return db.transaction(async (tx) => {
    const actor = await tx.query(
      "SELECT id FROM app_user WHERE id=$1 FOR UPDATE",
      [actorId],
    );
    if (!actor.rows.length) throw new DomainError("UNAUTHORIZED");
    const existing = await tx.query<{ owner_id: string }>(
      "SELECT owner_id FROM farm WHERE id=$1 FOR UPDATE",
      [input.idempotencyKey],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].owner_id !== actorId)
        throw new DomainError("FORBIDDEN");
      const receipt = await tx.query<{
        request_hash: string;
        response: FarmSummary;
      }>(
        "SELECT request_hash,response FROM command_receipt WHERE farm_id=$1 AND operation='farms.create' AND idempotency_key=$1",
        [input.idempotencyKey],
      );
      if (!receipt.rows[0] || receipt.rows[0].request_hash !== hash)
        throw new DomainError("CONFLICT");
      return receipt.rows[0].response;
    }
    await tx.query(
      "INSERT INTO farm(id,owner_id,name,location) VALUES($1,$2,$3,$4)",
      [input.idempotencyKey, actorId, input.name, input.location ?? null],
    );
    await tx.query(
      "INSERT INTO farm_membership(farm_id,user_id,added_by) VALUES($1,$2,$2)",
      [input.idempotencyKey, actorId],
    );
    const response = await getFarmInTransaction(
      tx,
      actorId,
      input.idempotencyKey,
    );
    await tx.query(
      `INSERT INTO command_receipt(farm_id,operation,idempotency_key,request_hash,response,created_by)
      VALUES($1,'farms.create',$1,$2,$3,$4)`,
      [input.idempotencyKey, hash, JSON.stringify(response), actorId],
    );
    return response;
  });
}
export async function updateFarm(
  db: Database,
  actorId: string,
  farmId: string,
  raw: unknown,
): Promise<FarmSummary> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  const input = updateFarmInput.parse(raw);
  return command(
    db,
    { actorId, farmId },
    "farms.update",
    input.idempotencyKey,
    input,
    async (tx) => {
      await tx.query(
        `UPDATE farm SET name=COALESCE($2,name),
      location=CASE WHEN $3 THEN $4 ELSE location END,updated_at=now()
      WHERE id=$1`,
        [
          farmId,
          input.name ?? null,
          input.location !== undefined,
          input.location ?? null,
        ],
      );
      return getFarmInTransaction(tx, actorId, farmId);
    },
  );
}
export async function archiveFarm(
  db: Database,
  actorId: string,
  farmId: string,
  raw: unknown,
): Promise<FarmSummary> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  const input = archiveFarmInput.parse(raw);
  return command(
    db,
    { actorId, farmId },
    "farms.archive",
    input.idempotencyKey,
    input,
    async (tx) => {
      await tx.query(
        "UPDATE farm SET archived_at=now(),archived_by=$2,updated_at=now() WHERE id=$1",
        [farmId, actorId],
      );
      return getFarmInTransaction(tx, actorId, farmId);
    },
  );
}

export async function addFarmMember(
  db: Database,
  actorId: string,
  farmId: string,
  raw: unknown,
) {
  uuid.parse(actorId);
  uuid.parse(farmId);
  const input = addFarmMemberInput.parse(raw);
  return command(
    db,
    { actorId, farmId },
    "farms.members.add",
    input.idempotencyKey,
    input,
    async (tx) => {
      const farm = await tx.query<{ owner_id: string }>(
        "SELECT owner_id FROM farm WHERE id=$1",
        [farmId],
      );
      if (farm.rows[0]?.owner_id !== actorId)
        throw new DomainError("FORBIDDEN");
      const account = await tx.query<{ id: string }>(
        `SELECT u.id FROM app_user u JOIN auth_credential c ON c.user_id=u.id
         WHERE c.email=$1`,
        [input.email],
      );
      if (!account.rows[0]) throw new DomainError("NOT_FOUND");
      await tx.query(
        `INSERT INTO farm_membership(farm_id,user_id,added_by) VALUES($1,$2,$3)
         ON CONFLICT (farm_id,user_id) DO NOTHING`,
        [farmId, account.rows[0].id, actorId],
      );
      return {
        id: account.rows[0].id,
        email: input.email,
      };
    },
  );
}

export async function removeFarmMember(
  db: Database,
  actorId: string,
  farmId: string,
  memberId: string,
  raw: unknown,
): Promise<{ memberId: string }> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(memberId);
  const input = removeFarmMemberInput.parse(raw);
  return command(
    db,
    { actorId, farmId },
    "farms.members.remove",
    input.idempotencyKey,
    { memberId, ...input },
    async (tx) => {
      const farm = await tx.query<{ owner_id: string }>(
        "SELECT owner_id FROM farm WHERE id=$1",
        [farmId],
      );
      if (farm.rows[0]?.owner_id !== actorId)
        throw new DomainError("FORBIDDEN");
      if (memberId === actorId) throw new DomainError("CONFLICT");
      const result = await tx.query<{ user_id: string }>(
        `DELETE FROM farm_membership WHERE farm_id=$1 AND user_id=$2
         RETURNING user_id`,
        [farmId, memberId],
      );
      if (!result.rows[0]) throw new DomainError("NOT_FOUND");
      return { memberId: result.rows[0].user_id };
    },
  );
}

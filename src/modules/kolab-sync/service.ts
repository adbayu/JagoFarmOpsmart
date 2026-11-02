import type { Database, Sql } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import { kolabDeliveryStatuses } from "../../shared/domain.js";
import {
  emptyKolabInput,
  kolabSessionInput,
  type KolabSyncStatus,
} from "./contracts.js";
import { encryptKolabSession, kolabSyncEnabled } from "./session.js";

function iso(value: string | Date | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

async function statusIn(tx: Sql, actor: string): Promise<KolabSyncStatus> {
  const session = (
    await tx.query<{ connectedAt: Date | string }>(
      `SELECT connected_at AS "connectedAt"
       FROM kolab_account_session WHERE user_id=$1`,
      [actor],
    )
  ).rows[0];
  const deliveries = await tx.query<{
    date: string;
    status: (typeof kolabDeliveryStatuses)[number];
    attemptCount: number;
    completedAt: Date | string | null;
    lastErrorCode: string | null;
  }>(
    `SELECT report_date::text AS date,status,attempt_count AS "attemptCount",
       completed_at AS "completedAt",last_error_code AS "lastErrorCode"
     FROM kolab_standup_delivery WHERE user_id=$1
     ORDER BY report_date DESC LIMIT 10`,
    [actor],
  );
  return {
    enabled: kolabSyncEnabled(),
    connectedAt: iso(session?.connectedAt ?? null),
    deliveries: deliveries.rows.map((row) => ({
      ...row,
      completedAt: iso(row.completedAt),
    })),
  };
}

export function createKolabSyncService(db: Database) {
  async function status(rawActor: string): Promise<KolabSyncStatus> {
    const actor = uuid.parse(rawActor);
    return db.transaction((tx) => statusIn(tx, actor));
  }

  async function connect(rawActor: string, raw: unknown) {
    const actor = uuid.parse(rawActor);
    const input = kolabSessionInput.parse(raw);
    const encrypted = encryptKolabSession(input, actor);
    const stamp = new Date().toISOString();
    return db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO kolab_account_session
           (user_id,encrypted_state,nonce,auth_tag,connected_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$5)
         ON CONFLICT(user_id) DO UPDATE SET encrypted_state=$2,nonce=$3,
           auth_tag=$4,connected_at=$5,updated_at=$5`,
        [
          actor,
          encrypted.encryptedState,
          encrypted.nonce,
          encrypted.authTag,
          stamp,
        ],
      );
      await tx.query(
        `UPDATE kolab_standup_delivery
         SET status='PENDING',attempt_count=0,next_attempt_at=$2,lease_expires_at=NULL,
             last_error_code=NULL,updated_at=$2
         WHERE user_id=$1 AND status='NEEDS_SESSION'`,
        [actor, stamp],
      );
      return statusIn(tx, actor);
    });
  }

  async function disconnect(rawActor: string) {
    const actor = uuid.parse(rawActor);
    const stamp = new Date().toISOString();
    return db.transaction(async (tx) => {
      await tx.query("DELETE FROM kolab_account_session WHERE user_id=$1", [
        actor,
      ]);
      await tx.query(
        `UPDATE kolab_standup_delivery
         SET status='NEEDS_SESSION',lease_expires_at=NULL,
             last_error_code='SESSION_REQUIRED',updated_at=$2
         WHERE user_id=$1 AND status IN ('PENDING','FAILED')`,
        [actor, stamp],
      );
      return statusIn(tx, actor);
    });
  }

  async function retry(rawActor: string, raw: unknown) {
    const actor = uuid.parse(rawActor);
    emptyKolabInput.parse(raw);
    const stamp = new Date().toISOString();
    return db.transaction(async (tx) => {
      const session = await tx.query(
        "SELECT user_id FROM kolab_account_session WHERE user_id=$1",
        [actor],
      );
      if (session.rows.length === 0) throw new DomainError("CONFLICT");
      await tx.query(
        `UPDATE kolab_standup_delivery
         SET status='PENDING',next_attempt_at=$2,lease_expires_at=NULL,
             last_error_code=NULL,updated_at=$2
         WHERE user_id=$1 AND status IN ('FAILED','NEEDS_REVIEW')
           AND report_date >= (($2::timestamptz AT TIME ZONE 'Asia/Jakarta')::date - 20)`,
        [actor, stamp],
      );
      return statusIn(tx, actor);
    });
  }

  return { status, connect, disconnect, retry };
}

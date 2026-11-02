import { chromium, type Browser } from "playwright";
import type { Database, Sql } from "../../server/db.js";
import {
  decryptKolabSession,
  kolabSyncEnabled,
  KolabSessionInvalidError,
} from "./session.js";
import { submitKolabReport, type KolabAutomationResult } from "./automation.js";

type Delivery = {
  userId: string;
  date: string;
  todayPlan: string;
  previousWork: string;
  blockers: string;
  encryptedState: Buffer | null;
  nonce: Buffer | null;
  authTag: Buffer | null;
  attemptCount: number;
};

const leaseMilliseconds = 120_000;
const maxAttempts = 3;

async function claimNext(db: Database, now: Date): Promise<Delivery | null> {
  return db.transaction(async (tx) => {
    const stamp = now.toISOString();
    await tx.query(
      `UPDATE kolab_standup_delivery
       SET status='NEEDS_REVIEW',lease_expires_at=NULL,
           last_error_code='SUBMIT_UNCERTAIN',updated_at=$1
       WHERE status='SENDING' AND lease_expires_at <= $1`,
      [stamp],
    );
    await tx.query(
      `UPDATE kolab_standup_delivery
       SET status='NEEDS_REVIEW',last_error_code='TOO_OLD',updated_at=$1
       WHERE status='PENDING'
         AND report_date < (($1::timestamptz AT TIME ZONE 'Asia/Jakarta')::date - 20)`,
      [stamp],
    );
    const row = (
      await tx.query<Delivery>(
        `SELECT d.user_id AS "userId",d.report_date::text AS date,
                s.published_plan AS "todayPlan",s.published_previous AS "previousWork",
                s.published_blockers AS blockers,
                a.encrypted_state AS "encryptedState",a.nonce,a.auth_tag AS "authTag",
                d.attempt_count AS "attemptCount"
         FROM kolab_standup_delivery d
         JOIN daily_standup s ON s.user_id=d.user_id AND s.report_date=d.report_date
         LEFT JOIN kolab_account_session a ON a.user_id=d.user_id
         WHERE d.status='PENDING' AND d.next_attempt_at <= $1
           AND ((d.report_date + time '12:00') AT TIME ZONE 'Asia/Jakarta') <= $1
         ORDER BY d.report_date,d.created_at,d.user_id
         LIMIT 1 FOR UPDATE OF d SKIP LOCKED`,
        [stamp],
      )
    ).rows[0];
    if (!row) return null;
    await tx.query(
      `UPDATE kolab_standup_delivery
       SET status='SENDING',attempt_count=attempt_count+1,
           lease_expires_at=$3,updated_at=$2
       WHERE user_id=$1 AND report_date=$4`,
      [
        row.userId,
        stamp,
        new Date(now.getTime() + leaseMilliseconds).toISOString(),
        row.date,
      ],
    );
    return { ...row, attemptCount: row.attemptCount + 1 };
  });
}

async function finish(
  tx: Sql,
  delivery: Delivery,
  result: KolabAutomationResult,
  now: Date,
): Promise<void> {
  const retry =
    result.status === "FAILED" && delivery.attemptCount < maxAttempts;
  const status = retry ? "PENDING" : result.status;
  const waitMinutes = delivery.attemptCount === 1 ? 1 : 5;
  const nextAttempt = retry
    ? new Date(now.getTime() + waitMinutes * 60_000).toISOString()
    : now.toISOString();
  const completed = ["SENT", "ALREADY_PRESENT"].includes(status)
    ? now.toISOString()
    : null;
  const errorCode =
    result.status === "NEEDS_SESSION"
      ? "SESSION_REQUIRED"
      : (result.errorCode ?? null);
  await tx.query(
    `UPDATE kolab_standup_delivery
     SET status=$3,lease_expires_at=NULL,completed_at=$4,next_attempt_at=$5,
         last_error_code=$6,updated_at=$7
     WHERE user_id=$1 AND report_date=$2 AND status='SENDING'`,
    [
      delivery.userId,
      delivery.date,
      status,
      completed,
      nextAttempt,
      errorCode,
      now.toISOString(),
    ],
  );
}

export function startKolabSyncWorker(db: Database): () => void {
  if (!kolabSyncEnabled()) return () => undefined;
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let browser: Browser | undefined;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      if (!browser?.isConnected()) {
        const launched = await chromium.launch({ headless: true });
        if (stopped) {
          await launched.close();
          return;
        }
        browser = launched;
      }
      for (let count = 0; count < 10 && !stopped; count++) {
        const now = new Date();
        const delivery = await claimNext(db, now);
        if (!delivery) break;
        let result: KolabAutomationResult;
        if (!delivery.encryptedState || !delivery.nonce || !delivery.authTag) {
          result = { status: "NEEDS_SESSION", errorCode: "LOGIN_REQUIRED" };
        } else {
          try {
            const state = decryptKolabSession(
              {
                encryptedState: delivery.encryptedState,
                nonce: delivery.nonce,
                authTag: delivery.authTag,
              },
              delivery.userId,
            );
            result = await submitKolabReport(browser, state, {
              date: delivery.date,
              fields: {
                todayPlan: delivery.todayPlan,
                previousWork: delivery.previousWork,
                blockers: delivery.blockers,
              },
            });
          } catch (error) {
            result =
              error instanceof KolabSessionInvalidError
                ? { status: "NEEDS_SESSION", errorCode: "LOGIN_REQUIRED" }
                : { status: "FAILED", errorCode: "NETWORK" };
          }
        }
        await db.transaction((tx) => finish(tx, delivery, result, new Date()));
      }
    } catch {
      console.error("Kolab sync worker tick failed");
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void run(), 60_000);
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    void browser?.close().catch(() => undefined);
  };
}

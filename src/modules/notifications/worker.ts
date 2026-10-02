import { randomUUID } from "node:crypto";
import type { Database, Sql } from "../../server/db.js";
import { recordInventoryLevelTransitions } from "./stock-events.js";
import { addOutboxEvent } from "./outbox.js";
import { materializeStaleAlerts } from "../iot/alerts.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 90 * DAY_MS;
const BATCH_SIZE = 200;

type Activity = {
  id: string;
  farm_id: string;
  kind: string;
  status: string;
  scheduled_at: string;
};

async function materializeScheduleEvents(tx: Sql, now: Date): Promise<void> {
  const nowIso = now.toISOString();
  const candidates = await tx.query<Activity>(
    `SELECT id,farm_id,kind,status,scheduled_at::text AS scheduled_at
     FROM activity
     WHERE (status='SCHEDULED' AND scheduled_at>$1 AND scheduled_at<=$2)
        OR (status IN ('SCHEDULED','MISSED') AND scheduled_at<=$1 AND scheduled_at>=$3)
     ORDER BY scheduled_at,id LIMIT 500 FOR UPDATE SKIP LOCKED`,
    [
      nowIso,
      new Date(now.getTime() + DAY_MS).toISOString(),
      new Date(now.getTime() - RETENTION_MS).toISOString(),
    ],
  );
  for (const activity of candidates.rows) {
    const overdue = new Date(activity.scheduled_at).getTime() <= now.getTime();
    const eventType = overdue ? "SCHEDULE_OVERDUE" : "SCHEDULE_REMINDER";
    const label = activity.kind.toLowerCase().replaceAll("_", " ");
    await addOutboxEvent(tx, {
      farmId: activity.farm_id,
      eventKey: `activity:${activity.id}:${eventType}`,
      eventType,
      sourceId: activity.id,
      payload: {
        title: overdue ? "Kegiatan melewati jadwal" : "Pengingat kegiatan",
        description: `${label} · ${new Date(activity.scheduled_at).toLocaleString("id-ID", { timeZone: "UTC" })} UTC`,
        href: "/schedule",
        sourceLabel: label,
      },
    });
  }
}

async function initializeInventoryStates(tx: Sql): Promise<void> {
  const missing = await tx.query<{ farm_id: string; id: string }>(
    `SELECT i.farm_id,i.id FROM inventory_item i
     LEFT JOIN inventory_notification_state s
       ON s.farm_id=i.farm_id AND s.inventory_item_id=i.id
     WHERE i.active=true AND s.inventory_item_id IS NULL
     ORDER BY i.farm_id,i.id LIMIT 500`,
  );
  for (const row of missing.rows)
    await recordInventoryLevelTransitions(tx, row.farm_id, [row.id]);
}

async function deliverOne(db: Database): Promise<boolean | null> {
  let attemptedId: string | undefined;
  try {
    return await db.transaction(async (tx) => {
      const result = await tx.query<{
        id: string;
        farm_id: string;
        resolved_at: string | null;
      }>(
        `SELECT id,farm_id,resolved_at::text AS resolved_at
         FROM notification_outbox WHERE delivered_at IS NULL
         ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      const event = result.rows[0];
      if (!event) return false;
      attemptedId = event.id;
      const recipients = await tx.query<{ user_id: string }>(
        "SELECT user_id FROM farm_membership WHERE farm_id=$1 ORDER BY user_id",
        [event.farm_id],
      );
      for (const recipient of recipients.rows)
        await tx.query(
          `INSERT INTO farm_notification
           (id,farm_id,outbox_id,recipient_id,resolved_at)
           VALUES($1,$2,$3,$4,$5) ON CONFLICT(outbox_id,recipient_id) DO NOTHING`,
          [
            randomUUID(),
            event.farm_id,
            event.id,
            recipient.user_id,
            event.resolved_at,
          ],
        );
      await tx.query(
        `UPDATE notification_outbox
         SET delivered_at=now(),attempt_count=attempt_count+1,last_error_code=NULL
         WHERE farm_id=$1 AND id=$2`,
        [event.farm_id, event.id],
      );
      return true;
    });
  } catch {
    if (attemptedId)
      await db.transaction((tx) =>
        tx
          .query(
            `UPDATE notification_outbox
           SET attempt_count=attempt_count+1,last_error_code='DELIVERY_FAILED'
           WHERE id=$1 AND delivered_at IS NULL`,
            [attemptedId],
          )
          .then(() => undefined),
      );
    return null;
  }
}

export async function processNotificationWorkerTick(
  db: Database,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await materializeScheduleEvents(tx, now);
    await initializeInventoryStates(tx);
    await materializeStaleAlerts(tx, now);
  });

  let deliveryFailed = false;
  let drained = false;
  for (let count = 0; count < BATCH_SIZE; count++) {
    const delivered = await deliverOne(db);
    if (delivered === false) {
      drained = true;
      break;
    }
    if (delivered === null) {
      deliveryFailed = true;
      break;
    }
  }
  if (!deliveryFailed && !drained)
    deliveryFailed = await db.transaction(async (tx) => {
      const pending = await tx.query(
        "SELECT id FROM notification_outbox WHERE delivered_at IS NULL LIMIT 1",
      );
      return pending.rows.length > 0;
    });

  await db.transaction(async (tx) => {
    const cutoff = new Date(now.getTime() - RETENTION_MS).toISOString();
    await tx.query("DELETE FROM farm_notification WHERE created_at<$1", [
      cutoff,
    ]);
    await tx.query(
      "DELETE FROM notification_outbox WHERE delivered_at IS NOT NULL AND delivered_at<$1",
      [cutoff],
    );
    await tx.query("SELECT purge_expired_iot_alert_history($1) AS deleted", [
      BATCH_SIZE,
    ]);
    if (!deliveryFailed)
      await tx.query(
        `INSERT INTO notification_worker_state(singleton,last_success_at)
         VALUES(true,$1) ON CONFLICT(singleton)
         DO UPDATE SET last_success_at=EXCLUDED.last_success_at`,
        [now.toISOString()],
      );
  });
}

export function startNotificationWorker(db: Database): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await processNotificationWorkerTick(db);
    } catch {
      console.error("Notification worker tick failed");
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void run(), 60_000);
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

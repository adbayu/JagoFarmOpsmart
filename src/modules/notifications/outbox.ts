import { randomUUID } from "node:crypto";
import type { Sql } from "../../server/db.js";
import type {
  NotificationEventType,
  NotificationPayload,
} from "./contracts.js";

export async function addOutboxEvent(
  tx: Sql,
  event: {
    farmId: string;
    eventKey: string;
    eventType: NotificationEventType;
    sourceId: string;
    payload: NotificationPayload;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO notification_outbox
     (id,farm_id,event_key,event_type,source_id,payload)
     VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(farm_id,event_key) DO NOTHING`,
    [
      randomUUID(),
      event.farmId,
      event.eventKey,
      event.eventType,
      event.sourceId,
      JSON.stringify(event.payload),
    ],
  );
}

export async function resolveOutboxEvent(
  tx: Sql,
  farmId: string,
  sourceId: string,
  resolvedAt: Date,
): Promise<void> {
  await tx.query(
    `UPDATE notification_outbox
     SET resolved_at=COALESCE(resolved_at,$3)
     WHERE farm_id=$1 AND source_id=$2 AND event_type='IOT_ALERT'`,
    [farmId, sourceId, resolvedAt.toISOString()],
  );
  await tx.query(
    `UPDATE farm_notification AS notification
     SET resolved_at=COALESCE(notification.resolved_at,$3)
     FROM notification_outbox AS outbox
     WHERE notification.farm_id=$1 AND notification.outbox_id=outbox.id
       AND outbox.farm_id=$1 AND outbox.source_id=$2
       AND outbox.event_type='IOT_ALERT'`,
    [farmId, sourceId, resolvedAt.toISOString()],
  );
}

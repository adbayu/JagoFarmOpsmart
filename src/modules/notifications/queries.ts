import type { Database, Sql } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import {
  notificationListInput,
  type NotificationList,
  type NotificationListItem,
  type NotificationPayload,
} from "./contracts.js";

async function assertFarmMember(
  tx: Sql,
  actorId: string,
  farmId: string,
): Promise<void> {
  const membership = await tx.query(
    "SELECT 1 FROM farm_membership WHERE farm_id=$1 AND user_id=$2",
    [farmId, actorId],
  );
  if (!membership.rows.length) throw new DomainError("FORBIDDEN");
}

type NotificationRow = {
  id: string;
  event_type: NotificationListItem["eventType"];
  source_id: string;
  payload: NotificationPayload | string;
  created_at: string;
  read_at: string | null;
  resolved_at: string | null;
};

function parsePayload(
  value: NotificationPayload | string,
): NotificationPayload {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return {
    title: String(parsed.title ?? "Notifikasi OpSmart"),
    description: String(parsed.description ?? ""),
    href: String(parsed.href ?? "/notifications"),
    sourceLabel: String(parsed.sourceLabel ?? "OpSmart"),
  };
}

export async function listNotifications(
  db: Database,
  actorId: string,
  farmId: string,
  rawPagination: unknown,
): Promise<NotificationList> {
  const { limit, offset } = notificationListInput.parse(rawPagination);
  return db.transaction(async (tx) => {
    await assertFarmMember(tx, actorId, farmId);
    const [items, unread, worker] = await Promise.all([
      tx.query<NotificationRow>(
        `SELECT n.id,o.event_type,o.source_id,o.payload,
          n.created_at::text AS created_at,n.read_at::text AS read_at,
          n.resolved_at::text AS resolved_at
         FROM farm_notification n JOIN notification_outbox o
           ON o.farm_id=n.farm_id AND o.id=n.outbox_id
         WHERE n.farm_id=$1 AND n.recipient_id=$2
         ORDER BY n.created_at DESC,n.id DESC LIMIT $3 OFFSET $4`,
        [farmId, actorId, limit, offset],
      ),
      tx.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM farm_notification
         WHERE farm_id=$1 AND recipient_id=$2 AND read_at IS NULL`,
        [farmId, actorId],
      ),
      tx.query<{ last_success_at: string }>(
        `SELECT last_success_at::text AS last_success_at
         FROM notification_worker_state WHERE singleton=true`,
      ),
    ]);
    return {
      items: items.rows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        sourceId: row.source_id,
        payload: parsePayload(row.payload),
        createdAt: row.created_at,
        readAt: row.read_at,
        resolvedAt: row.resolved_at,
      })),
      unreadCount: Number(unread.rows[0]?.count ?? 0),
      workerLastSuccessAt: worker.rows[0]?.last_success_at ?? null,
    };
  });
}

export async function markNotificationRead(
  db: Database,
  actorId: string,
  farmId: string,
  notificationId: string,
): Promise<{ readAt: string }> {
  return db.transaction(async (tx) => {
    await assertFarmMember(tx, actorId, farmId);
    const result = await tx.query<{ read_at: string }>(
      `UPDATE farm_notification SET read_at=COALESCE(read_at,now())
       WHERE farm_id=$1 AND id=$2 AND recipient_id=$3
       RETURNING read_at::text AS read_at`,
      [farmId, notificationId, actorId],
    );
    if (!result.rows[0]) throw new DomainError("NOT_FOUND");
    return { readAt: result.rows[0].read_at };
  });
}

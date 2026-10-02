import { z } from "zod";

export const notificationListInput = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export type NotificationEventType =
  "SCHEDULE_REMINDER" | "SCHEDULE_OVERDUE" | "LOW_STOCK" | "IOT_ALERT";

export type NotificationPayload = {
  title: string;
  description: string;
  href: string;
  sourceLabel: string;
};

export type NotificationListItem = {
  id: string;
  eventType: NotificationEventType;
  sourceId: string;
  payload: NotificationPayload;
  createdAt: string;
  readAt: string | null;
  resolvedAt: string | null;
};

export type NotificationList = {
  items: NotificationListItem[];
  unreadCount: number;
  workerLastSuccessAt: string | null;
};

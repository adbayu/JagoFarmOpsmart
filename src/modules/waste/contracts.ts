import { z } from "zod";
import { units, type Unit } from "../../shared/domain.js";
import { dateOnly, quantity, uuid } from "../../shared/validation.js";

export const wasteStatuses = [
  "RECORDED",
  "PROCESSING",
  "PROCESSED",
  "REUSED",
  "DISPOSED",
] as const;

export const createWasteRecordInput = z.strictObject({
  idempotencyKey: uuid,
  source: z.string().trim().min(1).max(200),
  quantity,
  unit: z.enum(units),
  wasteDate: dateOnly,
  notes: z.string().trim().max(2000).optional(),
});

export const transitionWasteRecordInput = z.strictObject({
  idempotencyKey: uuid,
  expectedStatus: z.enum(wasteStatuses),
  status: z.enum(["PROCESSING", "PROCESSED", "REUSED", "DISPOSED"]),
  usage: z.string().trim().min(1).max(300).optional(),
});

export type WasteStatus = (typeof wasteStatuses)[number];
export type WasteSummary = {
  id: string;
  source: string;
  quantity: string;
  unit: Unit;
  wasteDate: string;
  status: WasteStatus;
  usage: string | null;
  notes: string | null;
  createdBy: string;
  createdByName: string;
  updatedAt: string;
};
export type WasteHistoryEntry = {
  fromStatus: WasteStatus | null;
  toStatus: WasteStatus;
  reason: string | null;
  changedBy: string;
  changedByName: string;
  changedAt: string;
};
export type WasteDetail = WasteSummary & { history: WasteHistoryEntry[] };

import { z } from "zod";
import { units, type Unit } from "../../shared/domain.js";
import { dateOnly, quantity, uuid } from "../../shared/validation.js";

export const createMaggotBatchInput = z.strictObject({
  idempotencyKey: uuid,
  startedOn: dateOnly,
  media: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional(),
});

export const addMaggotBatchInputInput = z.strictObject({
  idempotencyKey: uuid,
  wasteId: uuid,
  quantity,
});

export const addMaggotObservationInput = z.strictObject({
  idempotencyKey: uuid,
  observedAt: z.iso.datetime({ offset: true }),
  observation: z.string().trim().min(1).max(1000),
});

export const recordMaggotOutputInput = z.strictObject({
  idempotencyKey: uuid,
  harvestedAt: z.iso.datetime({ offset: true }),
  quantity,
  unit: z.enum(units),
  notes: z.string().trim().max(1000).optional(),
});

export const recordMaggotOutputUseInput = z.strictObject({
  idempotencyKey: uuid,
  quantity,
  purpose: z.string().trim().min(1).max(300),
});

export const completeMaggotBatchInput = z.strictObject({
  idempotencyKey: uuid,
  expectedStatus: z.literal("OPEN"),
  completionNote: z.string().trim().min(1).max(1000),
});

export type MaggotBatchStatus = "OPEN" | "COMPLETED";
export type MaggotBatchSummary = {
  id: string;
  startedOn: string;
  media: string;
  status: MaggotBatchStatus;
  notes: string | null;
  completionNote: string | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
};
export type MaggotBatchInputSummary = {
  id: string;
  wasteId: string;
  source: string;
  quantity: string;
  unit: Unit;
  remainingQuantity: string;
  createdAt: string;
};
export type MaggotObservationSummary = {
  id: string;
  observedAt: string;
  observation: string;
  createdAt: string;
};
export type MaggotOutputUseSummary = {
  id: string;
  quantity: string;
  purpose: string;
  createdAt: string;
};
export type MaggotOutputPostingSummary = {
  id: string;
  movementId: string;
  lotId: string;
  itemName: string;
  lotLabel: string;
  quantity: string;
  unit: Unit;
  reason: string;
  createdAt: string;
};
export type MaggotOutputSummary = {
  id: string;
  harvestedAt: string;
  quantity: string;
  unit: Unit;
  usedQuantity: string;
  postedQuantity: string;
  remainingQuantity: string;
  notes: string | null;
  uses: MaggotOutputUseSummary[];
  postings: MaggotOutputPostingSummary[];
};
export type MaggotBatchDetail = MaggotBatchSummary & {
  inputs: MaggotBatchInputSummary[];
  observations: MaggotObservationSummary[];
  outputs: MaggotOutputSummary[];
};

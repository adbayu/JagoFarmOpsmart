import { z } from "zod";
import type { Unit } from "../../shared/domain.js";
import { dateOnly, quantity, uuid } from "../../shared/validation.js";

export const postMaggotOutputInput = z.strictObject({
  idempotencyKey: uuid,
  batchId: uuid,
  outputId: uuid,
  lotId: uuid,
  quantity,
  reason: z.string().trim().min(1).max(500),
});

export type CircularFeedLotOption = {
  lotId: string;
  itemId: string;
  itemName: string;
  label: string;
  unit: Unit;
  quantity: string;
};

export const recordWaterTransferInput = z.strictObject({
  idempotencyKey: uuid,
  sourceUnitId: uuid,
  targetUnitId: uuid,
  quantityLiters: quantity,
  transferDate: dateOnly,
  note: z.string().trim().max(500).optional(),
});

export type WaterTransferUnitOption = {
  id: string;
  name: string;
};

export type WaterTransferSummary = {
  id: string;
  sourceUnitId: string;
  sourceUnitName: string;
  targetUnitId: string;
  targetUnitName: string;
  quantityLiters: string;
  transferDate: string;
  note: string | null;
  createdByName: string;
  createdAt: string;
};

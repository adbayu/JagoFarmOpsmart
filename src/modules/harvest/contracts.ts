import { z } from "zod";
import { dateOnly, quantity, uuid } from "../../shared/validation.js";
export const postHarvestInput = z.strictObject({
  idempotencyKey: uuid,
  cycleId: uuid,
  harvestDate: dateOnly,
  location: z.string().max(300).optional(),
  notes: z.string().max(2000).optional(),
  outputs: z
    .array(
      z.strictObject({
        productId: uuid,
        quantity,
        weightKg: quantity.optional(),
        lotLabel: z.string().min(1).max(120),
      }),
    )
    .min(1)
    .max(100),
});
export type HarvestReceipt = {
  harvestId: string;
  outputs: { outputId: string; lotId: string; movementId: string }[];
};
export const cancelHarvestInput = z.strictObject({
  idempotencyKey: uuid,
  reason: z.string().trim().min(1).max(500),
});
export type HarvestSummary = {
  id: string;
  cycleId: string;
  cycleName: string;
  harvestDate: string;
  location: string | null;
  notes: string | null;
  status: "POSTED" | "CANCELLED";
  outputs: {
    id: string;
    productId: string;
    productName: string;
    grade: string | null;
    lotId: string;
    lotLabel: string;
    quantity: string;
    unit: string;
    weightKg: string | null;
    balance: string;
  }[];
};

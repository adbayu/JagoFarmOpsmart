import { z } from "zod";
import { moneyMinor, uuid } from "../../shared/validation.js";
import type { FarmingType, Unit } from "../../shared/domain.js";
export const createProductInput = z.strictObject({
  idempotencyKey: uuid,
  inventoryItemId: uuid,
  commodityId: uuid,
  name: z.string().trim().min(1).max(120),
  grade: z.string().trim().max(60).optional(),
  targetPriceMinor: moneyMinor.optional(),
});
export const updateProductInput = z.strictObject({
  idempotencyKey: uuid,
  name: z.string().trim().min(1).max(120),
  grade: z.string().trim().max(60).nullable(),
  targetPriceMinor: moneyMinor.nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});
export type ProductSummary = {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  commodityId: string;
  commodityName: string;
  type: FarmingType;
  name: string;
  grade: string | null;
  unit: Unit;
  targetPriceMinor: string | null;
  status: "ACTIVE" | "INACTIVE";
};
export type ProductItemOption = { id: string; name: string; unit: Unit };

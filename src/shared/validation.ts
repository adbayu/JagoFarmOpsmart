import { z } from "zod";
import { units } from "./domain.js";
export const uuid = z.uuid();
export const quantity = z
  .string()
  .regex(/^(0|[1-9]\d{0,11})(\.\d{1,3})?$/)
  .refine((v) => /[1-9]/.test(v), "Quantity must be greater than zero");
export const moneyMinor = z.string().regex(/^(0|[1-9]\d{0,15})$/);
export const dateOnly = z.iso.date();
export const contextSchema = z.strictObject({ farmId: uuid, actorId: uuid });
export const allocation = z.strictObject({ lotId: uuid, quantity });
export const consumeInput = z.strictObject({
  idempotencyKey: uuid,
  cycleId: uuid,
  activityId: uuid,
  inventoryItemId: uuid,
  unit: z.enum(units),
  allocations: z.array(allocation).min(1).max(100),
});
export const saleInput = z.strictObject({
  idempotencyKey: uuid,
  buyer: z.string().trim().min(1).max(200),
  saleDate: dateOnly,
  items: z
    .array(
      z.strictObject({
        productId: uuid,
        unitPriceMinor: moneyMinor,
        allocations: z.array(allocation).min(1).max(100),
      }),
    )
    .min(1)
    .max(50),
});
export type ConsumeInput = z.infer<typeof consumeInput>;
export type SaleInput = z.infer<typeof saleInput>;

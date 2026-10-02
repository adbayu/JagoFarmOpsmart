import { z } from "zod";
import {
  inventoryCategories,
  movementTypes,
  units,
} from "../../shared/domain.js";
import type { Unit } from "../../shared/domain.js";
import { dateOnly, quantity, uuid } from "../../shared/validation.js";
export { consumeInput } from "../../shared/validation.js";
const nonNegativeQuantity = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,3})?$/);
export const createInventoryItemInput = z.strictObject({
  idempotencyKey: uuid,
  name: z.string().trim().min(1).max(120),
  category: z.enum(inventoryCategories),
  unit: z.enum(units),
  minimumStock: nonNegativeQuantity.optional(),
});
export const updateInventoryItemInput = z.strictObject({
  idempotencyKey: uuid,
  name: z.string().trim().min(1).max(120),
  category: z.enum(inventoryCategories),
  unit: z.enum(units),
  minimumStock: nonNegativeQuantity,
  active: z.boolean(),
});
export const createInventoryLotInput = z.strictObject({
  idempotencyKey: uuid,
  inventoryItemId: uuid,
  label: z.string().trim().min(1).max(120),
  location: z.string().trim().max(500).optional(),
  expiresOn: dateOnly.optional(),
});
export const updateInventoryLotInput = z.strictObject({
  idempotencyKey: uuid,
  label: z.string().trim().min(1).max(120),
  location: z.string().trim().max(500).nullable(),
  expiresOn: dateOnly.nullable(),
});
export type InventoryItemSummary = {
  id: string;
  name: string;
  category: (typeof inventoryCategories)[number];
  unit: Unit;
  minimumStock: string;
  quantity: string;
  lotCount: number;
  active: boolean;
};
export type InventoryLotSummary = {
  id: string;
  inventoryItemId: string;
  label: string;
  location: string | null;
  expiresOn: string | null;
  quantity: string;
};
const reason = z.string().trim().min(1).max(500);
const signedQuantity = z
  .string()
  .regex(/^-?(0|[1-9]\d{0,11})(\.\d{1,3})?$/)
  .refine((value) => /[1-9]/.test(value), "Quantity delta must not be zero");
export const stockInInput = z.strictObject({
  idempotencyKey: uuid,
  lotId: uuid,
  quantity,
  reason,
});
export const adjustStockInput = z.strictObject({
  idempotencyKey: uuid,
  lotId: uuid,
  quantityDelta: signedQuantity,
  reason,
});
export const transferStockInput = z.strictObject({
  idempotencyKey: uuid,
  fromLotId: uuid,
  toLotId: uuid,
  quantity,
  reason,
});
export const disposeStockInput = z.strictObject({
  idempotencyKey: uuid,
  lotId: uuid,
  quantity,
  type: z.enum(["EXPIRED", "DAMAGED"]),
  reason,
});
export const reverseMovementInput = z.strictObject({
  idempotencyKey: uuid,
  movementId: uuid,
  reason,
});
export type MovementSummary = {
  id: string;
  inventoryItemId: string;
  itemName: string;
  lotId: string;
  lotLabel: string;
  type: (typeof movementTypes)[number];
  quantityDelta: string;
  unit: Unit;
  reason: string;
  reversalOf: string | null;
  transferGroup: string | null;
  createdAt: string;
};
export type ConsumableOption = {
  itemId: string;
  itemName: string;
  unit: Unit;
  lots: { lotId: string; lotLabel: string; quantity: string }[];
};
export type ConsumptionHistory = {
  consumptionId: string;
  movementId: string;
  itemName: string;
  lotLabel: string;
  quantity: string;
  unit: Unit;
  createdAt: string;
};

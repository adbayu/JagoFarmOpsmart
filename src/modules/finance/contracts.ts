import { z } from "zod";
import type { Metric, MoneyMinor, Quantity } from "../../shared/domain.js";
import { dateOnly, moneyMinor, uuid } from "../../shared/validation.js";
export const costTreatments = [
  "UNCLASSIFIED",
  "INVENTORY_PURCHASE",
  "PRODUCTION",
  "CAPITAL",
] as const;
const costFields = {
  idempotencyKey: uuid,
  cycleId: uuid.optional(),
  activityId: uuid.optional(),
  inventoryMovementId: uuid.optional(),
  sourceKey: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  treatment: z.enum(costTreatments).default("UNCLASSIFIED"),
  amountMinor: moneyMinor,
  costDate: dateOnly,
  notes: z.string().trim().max(2000).optional(),
};
export const recordCostInput = z
  .strictObject(costFields)
  .refine((v) => !v.activityId || !!v.cycleId)
  .refine((v) => v.treatment !== "PRODUCTION" || !!v.cycleId)
  .refine(
    (v) => v.treatment !== "INVENTORY_PURCHASE" || !!v.inventoryMovementId,
  );
export const correctCostInput = z
  .strictObject({
    ...costFields,
    correctionReason: z.string().trim().min(1).max(500),
  })
  .refine((v) => !v.activityId || !!v.cycleId)
  .refine((v) => v.treatment !== "PRODUCTION" || !!v.cycleId)
  .refine(
    (v) => v.treatment !== "INVENTORY_PURCHASE" || !!v.inventoryMovementId,
  );
export const cancelCostInput = z.strictObject({
  idempotencyKey: uuid,
  reason: z.string().trim().min(1).max(500),
});
export type CostSummary = {
  id: string;
  cycleId: string | null;
  cycleName: string | null;
  activityId: string | null;
  inventoryMovementId: string | null;
  movementType: string | null;
  sourceKey: string;
  category: string;
  treatment: "UNCLASSIFIED" | "INVENTORY_PURCHASE" | "PRODUCTION" | "CAPITAL";
  amountMinor: string;
  costDate: string;
  notes: string | null;
  status: "POSTED" | "CANCELLED";
  correctionOf: string | null;
  cancelReason: string | null;
  createdAt: string;
};
export type CostActivityOption = {
  id: string;
  cycleId: string;
  cycleName: string;
  kind: string;
  scheduledAt: string;
};
/** An approved valuation/allocation policy must prepare these inputs; no default policy exists. */
export type HppInputs = {
  productionCostMinor: MoneyMinor;
  outputQuantity: Quantity;
  unit: "KG" | "HEAD" | "UNIT";
  sourceCostIds: string[];
  sourceHarvestIds: string[];
  costsComplete: boolean;
  unavailableReason?: string;
  policyVersion: string;
  asOf: string;
};
export type HppResult = Metric<{
  costPerUnitMinor: string;
  totalProductionCostMinor: MoneyMinor;
  sourceCostIds: string[];
  sourceHarvestIds: string[];
}>;
export type CycleHppProjection = {
  cycleId: string;
  cycleName: string;
  costCompletion: { completedAt: string | null; current: boolean };
  productionWeightKg: Quantity;
  hpp: HppResult;
};
export const completeCycleCostsInput = z.strictObject({ idempotencyKey: uuid });

import { z } from "zod";
import {
  cycleStatuses,
  farmingTypes,
  type CycleStatus,
} from "../../shared/domain.js";
import { dateOnly, quantity, uuid } from "../../shared/validation.js";
const commonUnit = {
  idempotencyKey: uuid,
  name: z.string().trim().min(1).max(120),
  location: z.string().max(500).optional(),
};
const capacity = z.number().int().positive().max(2147483647);
export const createUnitInput = z.discriminatedUnion("type", [
  z.strictObject({
    ...commonUnit,
    type: z.literal("FISH"),
    areaM2: quantity.optional(),
    depthM: quantity.optional(),
    capacityHeads: capacity.optional(),
    condition: z.string().trim().max(500).optional(),
  }),
  z.strictObject({
    ...commonUnit,
    type: z.literal("CHICKEN"),
    areaM2: quantity.optional(),
    capacityHeads: capacity.optional(),
  }),
  z.strictObject({
    ...commonUnit,
    type: z.literal("CROP"),
    areaM2: quantity.optional(),
    media: z.string().max(200).optional(),
    capacityPlants: capacity.optional(),
  }),
]);
const unitChanges = {
  idempotencyKey: uuid,
  name: z.string().trim().min(1).max(120).optional(),
  location: z.string().max(500).nullable().optional(),
};
export const updateUnitInput = z.discriminatedUnion("type", [
  z.strictObject({
    ...unitChanges,
    type: z.literal("FISH"),
    areaM2: quantity.nullable().optional(),
    depthM: quantity.nullable().optional(),
    capacityHeads: capacity.nullable().optional(),
    condition: z.string().trim().max(500).nullable().optional(),
  }),
  z.strictObject({
    ...unitChanges,
    type: z.literal("CHICKEN"),
    areaM2: quantity.nullable().optional(),
    capacityHeads: capacity.nullable().optional(),
  }),
  z.strictObject({
    ...unitChanges,
    type: z.literal("CROP"),
    areaM2: quantity.nullable().optional(),
    media: z.string().max(200).nullable().optional(),
    capacityPlants: capacity.nullable().optional(),
  }),
]);
export const archiveUnitInput = z.strictObject({ idempotencyKey: uuid });
export type FarmingType = "FISH" | "CHICKEN" | "CROP";
export type UnitSummary = {
  id: string;
  farmId: string;
  type: FarmingType;
  name: string;
  location: string | null;
  active: boolean;
  areaM2: string | null;
  depthM: string | null;
  media: string | null;
  capacityHeads: number | null;
  capacityPlants: number | null;
  condition: string | null;
};
export type FishCycleSummary = {
  id: string;
  name: string;
  status: CycleStatus;
  commodityName: string;
  startDate: string;
  targetHarvestDate: string | null;
};
const cycle = {
  idempotencyKey: uuid,
  unitId: uuid,
  commodityId: uuid,
  name: z.string().trim().min(1).max(120),
  startDate: dateOnly,
  targetHarvestDate: dateOnly.optional(),
};
export const createCycleInput = z
  .discriminatedUnion("type", [
    z.strictObject({
      ...cycle,
      type: z.literal("FISH"),
      initialPopulation: z.number().int().positive().max(2147483647),
      seedSource: z.string().max(200).optional(),
      initialWeightG: quantity.optional(),
    }),
    z.strictObject({
      ...cycle,
      type: z.literal("CHICKEN"),
      initialPopulation: z.number().int().positive().max(2147483647),
      strain: z.string().max(200).optional(),
      initialAgeDays: z.number().int().nonnegative().max(2147483647).optional(),
      seedSource: z.string().max(200).optional(),
    }),
    z.strictObject({
      ...cycle,
      type: z.literal("CROP"),
      seedCount: z.number().int().positive().max(2147483647),
      variety: z.string().max(200).optional(),
      seedlingDate: dateOnly.optional(),
    }),
  ])
  .refine(
    (v) => !v.targetHarvestDate || v.targetHarvestDate >= v.startDate,
    "Harvest target must follow start date",
  );

export const createCommodityInput = z.strictObject({
  idempotencyKey: uuid,
  type: z.enum(farmingTypes),
  name: z.string().trim().min(1).max(120),
});
export const transitionCycleInput = z.strictObject({
  idempotencyKey: uuid,
  expectedStatus: z.enum(cycleStatuses),
  status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]),
});
export const createObservationInput = z
  .strictObject({
    idempotencyKey: uuid,
    observedAt: z.iso.datetime({ offset: true }),
    populationLoss: z.number().int().positive().max(2147483647).optional(),
    averageWeightG: quantity.optional(),
    conditionNotes: z.string().trim().min(1).max(2000).optional(),
  })
  .refine(
    (value) =>
      value.populationLoss !== undefined ||
      value.averageWeightG !== undefined ||
      value.conditionNotes !== undefined,
    "Record at least one observation",
  );

export type CommoditySummary = {
  id: string;
  type: FarmingType;
  name: string;
};
export type CycleSummary = {
  id: string;
  unitId: string;
  unitName: string;
  commodityId: string;
  commodityName: string;
  type: FarmingType;
  name: string;
  status: CycleStatus;
  startDate: string;
  targetHarvestDate: string | null;
  endedAt: string | null;
};
export type CycleDetail = CycleSummary &
  (
    | {
        type: "FISH";
        initialPopulation: number;
        seedSource: string | null;
        initialWeightG: string | null;
      }
    | {
        type: "CHICKEN";
        initialPopulation: number;
        strain: string | null;
        initialAgeDays: number | null;
        seedSource: string | null;
      }
    | {
        type: "CROP";
        seedCount: number;
        variety: string | null;
        seedlingDate: string | null;
      }
  );
export type ObservationSummary = {
  id: string;
  observedAt: string;
  populationLoss: number | null;
  averageWeightG: string | null;
  conditionNotes: string | null;
};

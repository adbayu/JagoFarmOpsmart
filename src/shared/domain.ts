// Runtime values shared with validation/UI. Migration parity is tested.
export const farmingTypes = ["FISH", "CHICKEN", "CROP"] as const;
export const standupStatuses = ["SUBMITTED", "PENDING", "MISSED"] as const;
export const standupDayStates = [
  "OPEN",
  "CLOSED",
  "DAY_OFF",
  "NOT_STARTED",
  "NOT_ELIGIBLE",
] as const;
export const cycleStatuses = [
  "PLANNED",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
] as const;
export const activityStatuses = [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "MISSED",
  "CANCELLED",
] as const;
export const activityKinds = [
  "STOCKING",
  "PLANTING",
  "FEEDING",
  "WATERING",
  "FERTILIZING",
  "MAINTENANCE",
  "INSPECTION",
  "TREATMENT",
  "HARVESTING",
] as const;
export const units = ["KG", "G", "L", "ML", "UNIT", "HEAD", "SEED"] as const;
export const movementTypes = [
  "STOCK_IN",
  "STOCK_OUT",
  "ADJUSTMENT",
  "TRANSFER",
  "CONSUMPTION",
  "EXPIRED",
  "DAMAGED",
  "REVERSAL",
] as const;
export const paymentStatuses = ["UNPAID", "PARTIAL", "PAID"] as const;
export const transactionStatuses = ["DRAFT", "COMPLETED", "CANCELLED"] as const;
export const productStatuses = ["ACTIVE", "INACTIVE"] as const;
export const recordStatuses = ["POSTED", "CANCELLED"] as const;
export const inventoryCategories = [
  "SEED",
  "LIVESTOCK_SEED",
  "FEED",
  "FERTILIZER",
  "NUTRIENT",
  "MEDICINE",
  "VITAMIN",
  "EQUIPMENT",
  "HARVEST_PRODUCT",
] as const;
export type FarmingType = (typeof farmingTypes)[number];
export type CycleStatus = (typeof cycleStatuses)[number];
export type ActivityStatus = (typeof activityStatuses)[number];
export type Unit = (typeof units)[number];
export type UUID = string;
/** Boundary values are strings. No floating point financial arithmetic. */
export type Quantity = string;
export type MoneyMinor = string;
export type CommandContext = Readonly<{ farmId: UUID; actorId: UUID }>;
export type Metric<T> =
  | { status: "AVAILABLE"; value: T; method: string; asOf: string }
  | { status: "UNAVAILABLE"; reason: string };

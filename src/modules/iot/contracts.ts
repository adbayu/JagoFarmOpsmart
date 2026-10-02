import { z } from "zod";
import { uuid } from "../../shared/validation.js";

const decimalValue = z
  .string()
  .regex(/^-?(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/);
const metricKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const measurementUnit = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/%-]{0,31}$/);
const offsetDateTime = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => Number.isFinite(Date.parse(value)),
    "Expected a valid ISO-8601 timestamp with an offset",
  );

export function compareTelemetryDecimals(left: string, right: string): number {
  const toScaled = (value: string) => {
    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const [whole = "0", fraction = ""] = unsigned.split(".");
    const scaled = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
    return negative ? -scaled : scaled;
  };

  const a = toScaled(left);
  const b = toScaled(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

const metricPairSchema = z.strictObject({
  metric: metricKey,
  unit: measurementUnit,
});

function uniqueMetricPairs<T extends { metric: string; unit: string }>(
  pairs: T[],
) {
  return (
    new Set(pairs.map(({ metric, unit }) => `${metric}\u0000${unit}`)).size ===
    pairs.length
  );
}

export const deviceCreateInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  farmUnitId: uuid,
  metrics: z.array(metricPairSchema).max(100).refine(uniqueMetricPairs),
});

export const deviceRenameInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});

export const deviceMetricsInputSchema = z.strictObject({
  metrics: z
    .array(
      z.strictObject({
        ...metricPairSchema.shape,
        active: z.boolean(),
      }),
    )
    .min(1)
    .max(100)
    .refine(uniqueMetricPairs),
});

export const readingInputSchema = z.strictObject({
  reading_id: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  metric: metricKey,
  unit: measurementUnit,
  value: decimalValue,
  observed_at: offsetDateTime,
  quality: z.enum(["GOOD", "SUSPECT", "INVALID"]).default("GOOD"),
});

export const readingBatchSchema = z.strictObject({
  readings: z.array(readingInputSchema).min(1).max(100),
});

export const deviceListQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const alertConfigInputSchema = z
  .strictObject({
    unit: measurementUnit,
    low: decimalValue.nullable(),
    high: decimalValue.nullable(),
    staleAfterSeconds: z.number().int().min(60).max(7_776_000).nullable(),
  })
  .refine(
    ({ low, high }) =>
      low === null || high === null || compareTelemetryDecimals(low, high) < 0,
    { message: "Batas bawah harus lebih kecil dari batas atas" },
  );

const deviceStatus = z.enum(["ACTIVE", "REVOKED"]);
const quality = z.enum(["GOOD", "SUSPECT", "INVALID"]);
const isoTimestamp = z.iso.datetime({ offset: true });

export const deviceMetricSummarySchema = z.strictObject({
  metric: metricKey,
  unit: measurementUnit,
  active: z.boolean(),
});

export const deviceSummarySchema = z.strictObject({
  id: uuid,
  name: z.string(),
  farmUnitId: uuid,
  farmUnitName: z.string(),
  status: deviceStatus,
  metrics: z.array(deviceMetricSummarySchema),
  lastReceivedAt: isoTimestamp.nullable(),
});

export const deviceListSchema = z.strictObject({
  items: z.array(deviceSummarySchema),
  nextCursor: z.string().nullable(),
});

export const ingestResultSchema = z.strictObject({
  stored: z.number().int().nonnegative(),
  duplicate: z.number().int().nonnegative(),
  results: z.array(
    z.strictObject({
      reading_id: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
      status: z.enum(["stored", "duplicate"]),
    }),
  ),
});

export type DeviceCreateInput = z.infer<typeof deviceCreateInputSchema>;
export type DeviceRenameInput = z.infer<typeof deviceRenameInputSchema>;
export type DeviceMetricsInput = z.infer<typeof deviceMetricsInputSchema>;
export type ReadingInput = z.infer<typeof readingInputSchema>;
export type ReadingBatch = z.infer<typeof readingBatchSchema>;
export type DeviceListQuery = z.infer<typeof deviceListQuerySchema>;
export type AlertConfigInput = z.infer<typeof alertConfigInputSchema>;
export type DeviceMetricSummary = z.infer<typeof deviceMetricSummarySchema>;
export type DeviceSummary = z.infer<typeof deviceSummarySchema>;
export type DeviceList = z.infer<typeof deviceListSchema>;
export type IngestResult = z.infer<typeof ingestResultSchema>;
export type ReadingQuality = z.infer<typeof quality>;

const decimalPattern = /^(-?)(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,6}))?$/;

export function canonicalDecimal(value: string): string {
  const match = decimalPattern.exec(value);
  if (!match) throw new TypeError("Invalid telemetry decimal");

  const [, sign, integer, rawFraction] = match;
  const fraction = rawFraction?.replace(/0+$/, "");
  const isZero = integer === "0" && (!rawFraction || /^0+$/.test(rawFraction));
  return `${sign === "-" && !isZero ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const MAX_AGE_MILLISECONDS = 90 * DAY_MILLISECONDS;
const MAX_FUTURE_MILLISECONDS = 5 * 60 * 1000;

export function validateObservedAt(value: string, databaseNow: Date): Date {
  const parsed = offsetDateTime.parse(value);
  const observedAt = new Date(parsed);
  const now = databaseNow.getTime();

  if (!Number.isFinite(now)) throw new RangeError("Invalid database timestamp");
  if (
    observedAt.getTime() < now - MAX_AGE_MILLISECONDS ||
    observedAt.getTime() > now + MAX_FUTURE_MILLISECONDS
  ) {
    throw new RangeError("Telemetry timestamp is outside the accepted window");
  }

  return observedAt;
}

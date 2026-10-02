import { createHash, randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { DomainError, RateLimitedError } from "../../shared/errors.js";
import type { Database, Sql } from "../../server/db.js";
import { evaluateThresholdAlerts } from "./alerts.js";
import {
  canonicalDecimal,
  readingBatchSchema,
  validateObservedAt,
  type IngestResult,
} from "./contracts.js";

const bearerTokenPattern = /^[A-Za-z0-9_-]{43}$/;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readBearerToken(
  authorization: string | undefined,
): string | null {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i);
  return match?.[1] ?? null;
}

type RateState =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

async function consumeRateToken(
  db: Database,
  tokenHash: string,
): Promise<RateState> {
  return db.transaction(async (tx) => {
    const device = await tx.query<{ id: string }>(
      `SELECT id FROM farm_device
       WHERE token_hash=$1 AND status='ACTIVE' FOR UPDATE`,
      [tokenHash],
    );
    if (!device.rows[0]) throw new DomainError("UNAUTHORIZED");

    const refill = await tx.query<{ tokens: string }>(
      `WITH db_clock AS (SELECT clock_timestamp() AS now)
       UPDATE farm_device AS device
       SET rate_limit_tokens = LEAST(
             120,
             device.rate_limit_tokens + GREATEST(
               0,
               EXTRACT(EPOCH FROM (db_clock.now-device.rate_refilled_at))*2
             )
           ),
           rate_refilled_at = db_clock.now
       FROM db_clock
       WHERE device.id=$1
       RETURNING device.rate_limit_tokens::text AS tokens`,
      [device.rows[0].id],
    );
    const available = Number(refill.rows[0]?.tokens ?? 0);
    if (available < 1) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((1 - available) / 2)),
      };
    }
    await tx.query(
      "UPDATE farm_device SET rate_limit_tokens=rate_limit_tokens-1 WHERE id=$1",
      [device.rows[0].id],
    );
    return { allowed: true };
  });
}

export function authenticateAndConsumeRateLimit(db: Database): RequestHandler {
  return (req, _res, next) => {
    const token = readBearerToken(req.get("authorization"));
    if (!token) {
      next(new DomainError("UNAUTHORIZED"));
      return;
    }
    void consumeRateToken(db, hashToken(token)).then(
      (state) => {
        if (!state.allowed) {
          next(new RateLimitedError(state.retryAfterSeconds));
          return;
        }
        next();
      },
      (error: unknown) => next(error),
    );
  };
}

function validationError(): never {
  throw new DomainError("VALIDATION");
}

type DeviceRow = {
  id: string;
  farm_id: string;
  farm_unit_id: string;
};

export async function ingestReadings(
  db: Database,
  bearerToken: string,
  raw: unknown,
): Promise<IngestResult> {
  if (!bearerTokenPattern.test(bearerToken))
    throw new DomainError("UNAUTHORIZED");
  let batch: ReturnType<typeof readingBatchSchema.parse>;
  try {
    batch = readingBatchSchema.parse(raw);
  } catch {
    return validationError();
  }
  const tokenHash = hashToken(bearerToken);

  return db.transaction(async (tx) => {
    const device = await tx.query<DeviceRow>(
      `SELECT id,farm_id,farm_unit_id FROM farm_device
       WHERE token_hash=$1 AND status='ACTIVE' FOR UPDATE`,
      [tokenHash],
    );
    if (!device.rows[0]) throw new DomainError("UNAUTHORIZED");
    const registry = device.rows[0];
    const clock = await tx.query<{ database_now: string }>(
      "SELECT clock_timestamp()::text AS database_now",
    );
    const databaseNowText = clock.rows[0]?.database_now;
    if (!databaseNowText) throw new DomainError("INTERNAL");
    const databaseNow = new Date(databaseNowText);
    if (!Number.isFinite(databaseNow.getTime()))
      throw new DomainError("INTERNAL");

    const storedMetrics = await tx.query<{
      metric_key: string;
      measurement_unit: string;
    }>(
      `SELECT metric_key,measurement_unit FROM farm_device_metric
       WHERE device_id=$1 AND active=true`,
      [registry.id],
    );
    const activeMetrics = new Set(
      storedMetrics.rows.map(
        ({ metric_key, measurement_unit }) =>
          `${metric_key}\u0000${measurement_unit}`,
      ),
    );

    let stored = 0;
    let duplicate = 0;
    const evaluatedPairs = new Map<string, { metric: string; unit: string }>();
    const results: IngestResult["results"] = [];
    for (const reading of batch.readings) {
      try {
        validateObservedAt(reading.observed_at, databaseNow);
      } catch {
        return validationError();
      }
      const timeWindow = await tx.query<{ valid: boolean }>(
        `SELECT $1::timestamptz >= $2::timestamptz-interval '90 days'
           AND $1::timestamptz <= $2::timestamptz+interval '5 minutes' AS valid`,
        [reading.observed_at, databaseNowText],
      );
      if (!timeWindow.rows[0]?.valid) return validationError();

      const quality = reading.quality;
      const value = canonicalDecimal(reading.value);
      const existing = await tx.query<{ identical: boolean }>(
        `SELECT metric_key=$3
           AND measurement_unit=$4
           AND value=$5::numeric
           AND observed_at=$6::timestamptz
           AND quality=$7::telemetry_quality AS identical
         FROM telemetry_reading
         WHERE device_id=$1 AND reading_id=$2`,
        [
          registry.id,
          reading.reading_id,
          reading.metric,
          reading.unit,
          value,
          reading.observed_at,
          quality,
        ],
      );
      if (existing.rows[0]) {
        if (!existing.rows[0].identical) throw new DomainError("CONFLICT");
        duplicate += 1;
        results.push({ reading_id: reading.reading_id, status: "duplicate" });
        continue;
      }
      if (!activeMetrics.has(`${reading.metric}\u0000${reading.unit}`))
        return validationError();

      await tx.query(
        `INSERT INTO telemetry_reading
           (id,device_id,farm_id,farm_unit_id,reading_id,metric_key,
            measurement_unit,value,observed_at,quality)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::telemetry_quality)`,
        [
          randomUUID(),
          registry.id,
          registry.farm_id,
          registry.farm_unit_id,
          reading.reading_id,
          reading.metric,
          reading.unit,
          value,
          reading.observed_at,
          quality,
        ],
      );
      stored += 1;
      results.push({ reading_id: reading.reading_id, status: "stored" });
      if (quality === "GOOD")
        evaluatedPairs.set(`${reading.metric}\u0000${reading.unit}`, {
          metric: reading.metric,
          unit: reading.unit,
        });
    }
    if (evaluatedPairs.size)
      await evaluateThresholdAlerts(
        tx,
        { id: registry.id, farm_id: registry.farm_id },
        [...evaluatedPairs.values()],
        databaseNow,
      );
    return { stored, duplicate, results };
  });
}

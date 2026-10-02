import { z } from "zod";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import type { Database } from "../../server/db.js";
import { assertFarmMember } from "../farms/access.js";
import {
  deviceListQuerySchema,
  deviceSummarySchema,
  type DeviceList,
  type DeviceMetricSummary,
} from "./contracts.js";

export type LatestTelemetryReading = {
  id: string;
  readingId: string;
  farmUnitId: string;
  metric: string;
  unit: string;
  value: string;
  observedAt: string;
  receivedAt: string;
  quality: "GOOD" | "SUSPECT";
};

const cursorSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  id: uuid,
});

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    throw new DomainError("VALIDATION");
  }
}

function encodeCursor(createdAt: Date | string, id: string): string {
  const timestamp =
    createdAt instanceof Date
      ? createdAt.toISOString()
      : new Date(createdAt).toISOString();
  return Buffer.from(JSON.stringify({ createdAt: timestamp, id })).toString(
    "base64url",
  );
}

function timestamp(value: Date | string | null): string | null {
  return value === null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
}

type DeviceRow = {
  id: string;
  label: string;
  farm_unit_id: string;
  farm_unit_name: string;
  status: "ACTIVE" | "REVOKED";
  metrics: DeviceMetricSummary[] | string;
  last_received_at: Date | string | null;
  created_at: Date | string;
};

export async function listDevices(
  db: Database,
  actorId: string,
  farmId: string,
  rawOptions: unknown,
): Promise<DeviceList> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  const options = deviceListQuerySchema.parse(rawOptions);
  const cursor = decodeCursor(options.cursor);
  return db.transaction(async (tx) => {
    await assertFarmMember(tx, actorId, farmId);
    const result = await tx.query<DeviceRow>(
      `SELECT d.id,d.label,d.farm_unit_id,u.name AS farm_unit_name,d.status,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'metric',m.metric_key,'unit',m.measurement_unit,'active',m.active
           ) ORDER BY m.metric_key,m.measurement_unit)
           FROM farm_device_metric m WHERE m.device_id=d.id
         ),'[]'::jsonb) AS metrics,
         (SELECT max(r.received_at) FROM telemetry_reading r
          WHERE r.device_id=d.id) AS last_received_at,
         d.created_at
       FROM farm_device d
       JOIN farm_unit u ON u.farm_id=d.farm_id AND u.id=d.farm_unit_id
       JOIN farm_membership membership
         ON membership.farm_id=d.farm_id AND membership.user_id=$2
       WHERE d.farm_id=$1
         AND ($3::timestamptz IS NULL OR
              (d.created_at,d.id) < ($3::timestamptz,$4::uuid))
       ORDER BY d.created_at DESC,d.id DESC
       LIMIT $5`,
      [
        farmId,
        actorId,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        options.limit + 1,
      ],
    );
    const hasMore = result.rows.length > options.limit;
    const rows = result.rows.slice(0, options.limit);
    const items = rows.map((row) => {
      const metrics =
        typeof row.metrics === "string" ? JSON.parse(row.metrics) : row.metrics;
      return deviceSummarySchema.parse({
        id: row.id,
        name: row.label,
        farmUnitId: row.farm_unit_id,
        farmUnitName: row.farm_unit_name,
        status: row.status,
        metrics,
        lastReceivedAt: timestamp(row.last_received_at),
      });
    });
    const lastRow = rows.at(-1);
    return {
      items,
      nextCursor:
        hasMore && lastRow
          ? encodeCursor(lastRow.created_at, lastRow.id)
          : null,
    };
  });
}

export async function latestTelemetryReading(
  db: Database,
  actorId: string,
  farmId: string,
  farmUnitId: string,
  metric: string,
  unit: string,
): Promise<LatestTelemetryReading | null> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(farmUnitId);
  return db.transaction(async (tx) => {
    await assertFarmMember(tx, actorId, farmId);
    const result = await tx.query<{
      id: string;
      reading_id: string;
      farm_unit_id: string;
      metric_key: string;
      measurement_unit: string;
      value: string;
      observed_at: Date | string;
      received_at: Date | string;
      quality: "GOOD" | "SUSPECT";
    }>(
      `SELECT id,reading_id,farm_unit_id,metric_key,measurement_unit,
         value::text AS value,observed_at,received_at,quality
       FROM telemetry_reading
       WHERE farm_id=$1 AND farm_unit_id=$2 AND metric_key=$3
         AND measurement_unit=$4 AND quality <> 'INVALID'
       ORDER BY observed_at DESC,received_at DESC,id DESC
       LIMIT 1`,
      [farmId, farmUnitId, metric, unit],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      readingId: row.reading_id,
      farmUnitId: row.farm_unit_id,
      metric: row.metric_key,
      unit: row.measurement_unit,
      value: row.value,
      observedAt: timestamp(row.observed_at)!,
      receivedAt: timestamp(row.received_at)!,
      quality: row.quality,
    };
  });
}

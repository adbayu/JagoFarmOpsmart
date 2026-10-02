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
  type ReadingQuality,
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
  quality: Exclude<ReadingQuality, "INVALID">;
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

const pageCursorSchema = z.strictObject({
  observedAt: z.iso.datetime({ offset: true }),
  receivedAt: z.iso.datetime({ offset: true }),
  id: uuid,
});

function pageCursor(value: string | undefined) {
  if (!value) return null;
  try {
    return pageCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    throw new DomainError("VALIDATION");
  }
}

function encodePageCursor(value: {
  observedAt: Date | string;
  receivedAt: Date | string;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      observedAt: timestamp(value.observedAt),
      receivedAt: timestamp(value.receivedAt),
      id: value.id,
    }),
  ).toString("base64url");
}

const alertCursorSchema = z.strictObject({
  openedAt: z.iso.datetime({ offset: true }),
  id: uuid,
});

function alertCursor(value: string | undefined) {
  if (!value) return null;
  try {
    return alertCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    throw new DomainError("VALIDATION");
  }
}

type AlertEpisodeRow = {
  id: string;
  metric_key: string;
  measurement_unit: string;
  condition_kind: string;
  config_version: number;
  opened_at: Date | string;
  resolved_at: Date | string | null;
  open_reason: string;
  resolved_reason: string | null;
  source_reading_id: string | null;
  source_value: string | null;
  source_unit: string | null;
  source_observed_at: Date | string | null;
  evaluated_at: Date | string;
  low_threshold: string | null;
  high_threshold: string | null;
  stale_after_seconds: number | null;
};

const pageQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

async function assertDeviceInFarm(
  tx: import("../../server/db.js").Sql,
  actorId: string,
  farmId: string,
  deviceId: string,
): Promise<void> {
  await assertFarmMember(tx, actorId, farmId);
  const device = await tx.query(
    `SELECT 1 FROM farm_device WHERE farm_id=$1 AND id=$2`,
    [farmId, deviceId],
  );
  if (!device.rows.length) throw new DomainError("NOT_FOUND");
}

export async function listTelemetryReadings(
  db: Database,
  actorId: string,
  farmId: string,
  deviceId: string,
  rawOptions: unknown,
) {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(deviceId);
  const options = z
    .strictObject({
      ...pageQuerySchema.shape,
      metric: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      unit: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/%-]{0,31}$/),
    })
    .parse(rawOptions);
  const cursor = pageCursor(options.cursor);
  return db.transaction(async (tx) => {
    await assertDeviceInFarm(tx, actorId, farmId, deviceId);
    const result = await tx.query<{
      id: string;
      reading_id: string;
      metric_key: string;
      measurement_unit: string;
      value: string;
      quality: ReadingQuality;
      observed_at: Date | string;
      received_at: Date | string;
    }>(
      `SELECT id,reading_id,metric_key,measurement_unit,value::text AS value,
         quality,observed_at,received_at
       FROM telemetry_reading
       WHERE farm_id=$1 AND device_id=$2 AND metric_key=$3 AND measurement_unit=$4
         AND ($5::timestamptz IS NULL OR
           (observed_at,received_at,id)<($5::timestamptz,$6::timestamptz,$7::uuid))
       ORDER BY observed_at DESC,received_at DESC,id DESC LIMIT $8`,
      [
        farmId,
        deviceId,
        options.metric,
        options.unit,
        cursor?.observedAt ?? null,
        cursor?.receivedAt ?? null,
        cursor?.id ?? null,
        options.limit + 1,
      ],
    );
    const hasMore = result.rows.length > options.limit;
    const rows = result.rows.slice(0, options.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => ({
        id: row.id,
        readingId: row.reading_id,
        metric: row.metric_key,
        unit: row.measurement_unit,
        value: row.value,
        quality: row.quality,
        observedAt: timestamp(row.observed_at)!,
        receivedAt: timestamp(row.received_at)!,
      })),
      nextCursor:
        hasMore && last
          ? encodePageCursor({
              observedAt: last.observed_at,
              receivedAt: last.received_at,
              id: last.id,
            })
          : null,
    };
  });
}

export async function listDeviceAlerts(
  db: Database,
  actorId: string,
  farmId: string,
  deviceId: string,
  rawOptions: unknown,
) {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(deviceId);
  const options = pageQuerySchema.parse(rawOptions);
  const cursor = alertCursor(options.cursor);
  return db.transaction(async (tx) => {
    await assertDeviceInFarm(tx, actorId, farmId, deviceId);
    const [configs, result, activeResult] = await Promise.all([
      tx.query<{
        metric_key: string;
        measurement_unit: string;
        active: boolean;
        version: number | null;
        low_threshold: string | null;
        high_threshold: string | null;
        stale_after_seconds: number | null;
        changed_by: string | null;
        changed_by_name: string | null;
        changed_at: Date | string | null;
        latest_reading_id: string | null;
        latest_reading_key: string | null;
        latest_value: string | null;
        latest_quality: ReadingQuality | null;
        latest_observed_at: Date | string | null;
        latest_received_at: Date | string | null;
      }>(
        `SELECT m.metric_key,m.measurement_unit,m.active,c.version,
           c.low_threshold::text AS low_threshold,c.high_threshold::text AS high_threshold,
           c.stale_after_seconds,c.changed_by,u.display_name AS changed_by_name,
           c.created_at AS changed_at,r.id AS latest_reading_id,
           r.reading_id AS latest_reading_key,r.value::text AS latest_value,
           r.quality AS latest_quality,r.observed_at AS latest_observed_at,
           r.received_at AS latest_received_at
         FROM farm_device_metric m
         LEFT JOIN LATERAL (
           SELECT version,low_threshold,high_threshold,stale_after_seconds,changed_by,created_at
           FROM farm_device_alert_config c
           WHERE c.device_id=m.device_id AND c.metric_key=m.metric_key
             AND c.measurement_unit=m.measurement_unit
           ORDER BY version DESC LIMIT 1
         ) c ON true
         LEFT JOIN app_user u ON u.id=c.changed_by
         LEFT JOIN LATERAL (
           SELECT id,reading_id,value,quality,observed_at,received_at
           FROM telemetry_reading r
           WHERE r.farm_id=$2 AND r.device_id=m.device_id
             AND r.metric_key=m.metric_key AND r.measurement_unit=m.measurement_unit
           ORDER BY observed_at DESC,received_at DESC,id DESC LIMIT 1
         ) r ON true
         WHERE m.device_id=$1
         ORDER BY m.metric_key,m.measurement_unit`,
        [deviceId, farmId],
      ),
      tx.query<AlertEpisodeRow>(
        `SELECT e.id,e.metric_key,e.measurement_unit,e.condition_kind,
           e.config_version,e.opened_at,e.resolved_at,e.open_reason,e.resolved_reason,
           e.source_reading_id,e.source_value::text AS source_value,e.source_unit,
           e.source_observed_at,e.evaluated_at,c.low_threshold::text AS low_threshold,
           c.high_threshold::text AS high_threshold,c.stale_after_seconds
         FROM farm_device_alert_episode e
         JOIN farm_device_alert_config c ON c.device_id=e.device_id
           AND c.metric_key=e.metric_key AND c.measurement_unit=e.measurement_unit
           AND c.version=e.config_version
         WHERE e.farm_id=$1 AND e.device_id=$2
           AND ($3::timestamptz IS NULL OR (e.opened_at,e.id)<($3::timestamptz,$4::uuid))
         ORDER BY e.opened_at DESC,e.id DESC LIMIT $5`,
        [
          farmId,
          deviceId,
          cursor?.openedAt ?? null,
          cursor?.id ?? null,
          options.limit + 1,
        ],
      ),
      tx.query<AlertEpisodeRow>(
        `SELECT e.id,e.metric_key,e.measurement_unit,e.condition_kind,
           e.config_version,e.opened_at,e.resolved_at,e.open_reason,e.resolved_reason,
           e.source_reading_id,e.source_value::text AS source_value,e.source_unit,
           e.source_observed_at,e.evaluated_at,c.low_threshold::text AS low_threshold,
           c.high_threshold::text AS high_threshold,c.stale_after_seconds
         FROM farm_device_alert_episode e
         JOIN farm_device_alert_config c ON c.device_id=e.device_id
           AND c.metric_key=e.metric_key AND c.measurement_unit=e.measurement_unit
           AND c.version=e.config_version
         WHERE e.farm_id=$1 AND e.device_id=$2 AND e.resolved_at IS NULL
         ORDER BY e.opened_at DESC,e.id DESC`,
        [farmId, deviceId],
      ),
    ]);
    const hasMore = result.rows.length > options.limit;
    const rows = result.rows.slice(0, options.limit);
    const activeRows = activeResult.rows;
    const allRows = Array.from(
      new Map<string, AlertEpisodeRow>(
        [...rows, ...activeRows].map((row) => [row.id, row] as const),
      ).values(),
    );
    const ids = allRows.map((row) => row.id);
    const transitions = ids.length
      ? await tx.query<{
          id: string;
          episode_id: string;
          transition_type: string;
          occurred_at: Date | string;
          actor_id: string | null;
          actor_name: string | null;
          reason: string;
          source_reading_id: string | null;
          source_value: string | null;
          source_unit: string | null;
          source_observed_at: Date | string | null;
        }>(
          `SELECT t.id,t.episode_id,t.transition_type,t.occurred_at,t.actor_id,
             u.display_name AS actor_name,t.reason,t.source_reading_id,
             t.source_value::text AS source_value,t.source_unit,t.source_observed_at
           FROM farm_device_alert_transition t
           LEFT JOIN app_user u ON u.id=t.actor_id
           WHERE t.farm_id=$1 AND t.episode_id=ANY($2::uuid[])
           ORDER BY t.occurred_at,t.id`,
          [farmId, ids],
        )
      : { rows: [] };
    const grouped = new Map<string, typeof transitions.rows>();
    for (const transition of transitions.rows) {
      const list = grouped.get(transition.episode_id) ?? [];
      list.push(transition);
      grouped.set(transition.episode_id, list);
    }
    const last = rows.at(-1);
    const mapEpisode = (row: AlertEpisodeRow) => ({
      id: row.id,
      metric: row.metric_key,
      unit: row.measurement_unit,
      condition: row.condition_kind,
      configVersion: row.config_version,
      openedAt: timestamp(row.opened_at),
      resolvedAt: timestamp(row.resolved_at),
      openReason: row.open_reason,
      resolvedReason: row.resolved_reason,
      sourceReadingId: row.source_reading_id,
      sourceValue: row.source_value,
      sourceUnit: row.source_unit,
      sourceObservedAt: timestamp(row.source_observed_at),
      evaluatedAt: timestamp(row.evaluated_at),
      low: row.low_threshold,
      high: row.high_threshold,
      staleAfterSeconds: row.stale_after_seconds,
      transitions: (grouped.get(row.id) ?? []).map((transition) => ({
        id: transition.id,
        type: transition.transition_type,
        occurredAt: timestamp(transition.occurred_at),
        actorId: transition.actor_id,
        actorName: transition.actor_name,
        reason: transition.reason,
        sourceReadingId: transition.source_reading_id,
        sourceValue: transition.source_value,
        sourceUnit: transition.source_unit,
        sourceObservedAt: timestamp(transition.source_observed_at),
      })),
    });
    return {
      configs: configs.rows.map((row) => ({
        metric: row.metric_key,
        unit: row.measurement_unit,
        active: row.active,
        version: row.version,
        low: row.low_threshold,
        high: row.high_threshold,
        staleAfterSeconds: row.stale_after_seconds,
        changedBy: row.changed_by,
        changedByName: row.changed_by_name,
        changedAt: timestamp(row.changed_at),
        latestReading: row.latest_reading_id
          ? {
              id: row.latest_reading_id,
              readingId: row.latest_reading_key,
              value: row.latest_value,
              quality: row.latest_quality,
              observedAt: timestamp(row.latest_observed_at),
              receivedAt: timestamp(row.latest_received_at),
            }
          : null,
      })),
      items: rows.map(mapEpisode),
      activeItems: activeRows.map(mapEpisode),
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({
                openedAt: timestamp(last.opened_at),
                id: last.id,
              }),
            ).toString("base64url")
          : null,
    };
  });
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

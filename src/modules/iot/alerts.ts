import { randomUUID } from "node:crypto";
import type { CommandContext } from "../../shared/domain.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import { command } from "../../server/command.js";
import type { Database, Sql } from "../../server/db.js";
import { addOutboxEvent, resolveOutboxEvent } from "../notifications/outbox.js";
import {
  alertConfigInputSchema,
  compareTelemetryDecimals,
  type AlertConfigInput,
} from "./contracts.js";

export type ThresholdCondition = "LOW" | "HIGH";

export function evaluateThreshold(
  value: string,
  config: Pick<AlertConfigInput, "low" | "high">,
): ThresholdCondition | null {
  if (config.low !== null && compareTelemetryDecimals(value, config.low) < 0)
    return "LOW";
  if (config.high !== null && compareTelemetryDecimals(value, config.high) > 0)
    return "HIGH";
  return null;
}

type AlertPair = { metric: string; unit: string };
type DeviceAlertScope = { id: string; farm_id: string };
type ConfigRow = {
  version: number;
  low_threshold: string | null;
  high_threshold: string | null;
  stale_after_seconds: number | null;
  changed_by: string;
  created_at: string;
};
type GoodReading = {
  id: string;
  reading_id: string;
  value: string;
  measurement_unit: string;
  observed_at: string;
  received_at: string;
};
type OpenEpisode = { id: string; condition_kind: ThresholdCondition | "STALE" };
type CloseReason =
  "RECOVERED" | "CONFIG_CHANGED" | "METRIC_DISABLED" | "DEVICE_REVOKED";

function configThresholds(config: ConfigRow) {
  return { low: config.low_threshold, high: config.high_threshold };
}

function sameDecimal(left: string | null, right: string | null): boolean {
  return left === null || right === null
    ? left === right
    : compareTelemetryDecimals(left, right) === 0;
}

async function latestGoodReading(
  tx: Sql,
  deviceId: string,
  metric: string,
  unit: string,
): Promise<GoodReading | null> {
  const result = await tx.query<GoodReading>(
    `SELECT id,reading_id,value::text AS value,measurement_unit,
       observed_at::text AS observed_at,received_at::text AS received_at
     FROM telemetry_reading
     WHERE device_id=$1 AND metric_key=$2 AND measurement_unit=$3
       AND quality='GOOD'
     ORDER BY observed_at DESC,received_at DESC,id DESC LIMIT 1`,
    [deviceId, metric, unit],
  );
  return result.rows[0] ?? null;
}

async function latestConfig(
  tx: Sql,
  deviceId: string,
  metric: string,
  unit: string,
): Promise<ConfigRow | null> {
  const result = await tx.query<ConfigRow>(
    `SELECT version,low_threshold::text AS low_threshold,
       high_threshold::text AS high_threshold,stale_after_seconds,changed_by,
       created_at::text AS created_at
     FROM farm_device_alert_config
     WHERE device_id=$1 AND metric_key=$2 AND measurement_unit=$3
     ORDER BY version DESC LIMIT 1`,
    [deviceId, metric, unit],
  );
  return result.rows[0] ?? null;
}

async function appendTransition(
  tx: Sql,
  episode: {
    id: string;
    farmId: string;
    configVersion: number;
    metric: string;
    unit: string;
  },
  transition: string,
  reason: string,
  actorId: string | null,
  reading: GoodReading | null,
  now: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO farm_device_alert_transition
       (id,farm_id,episode_id,transition_type,occurred_at,actor_id,reason,
        source_reading_id,source_value,source_unit,source_observed_at,config_version)
     VALUES($1,$2,$3,$4,$5::timestamptz,$6,$7,$8,$9,$10,$11::timestamptz,$12)`,
    [
      randomUUID(),
      episode.farmId,
      episode.id,
      transition,
      now.toISOString(),
      actorId,
      reason,
      reading?.id ?? null,
      reading?.value ?? null,
      reading?.measurement_unit ?? null,
      reading?.observed_at ?? null,
      episode.configVersion,
    ],
  );
}

async function openEpisode(
  tx: Sql,
  device: DeviceAlertScope,
  pair: AlertPair,
  config: ConfigRow,
  condition: ThresholdCondition | "STALE",
  reading: GoodReading | null,
  now: Date,
  actorId: string | null,
): Promise<string> {
  const id = randomUUID();
  const stale = condition === "STALE";
  const threshold =
    condition === "LOW" ? config.low_threshold : config.high_threshold;
  await tx.query(
    `INSERT INTO farm_device_alert_episode
       (id,farm_id,device_id,metric_key,measurement_unit,condition_kind,
        config_version,opened_at,open_reason,opened_by,source_reading_id,
        source_value,source_unit,source_observed_at,evaluated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9,$10,$11,$12,$13,
       $14::timestamptz,$8::timestamptz)`,
    [
      id,
      device.farm_id,
      device.id,
      pair.metric,
      pair.unit,
      condition,
      config.version,
      now.toISOString(),
      stale ? "STALE_TIMEOUT" : "THRESHOLD",
      actorId,
      reading?.id ?? null,
      reading?.value ?? null,
      reading?.measurement_unit ?? null,
      reading?.observed_at ?? null,
    ],
  );
  await appendTransition(
    tx,
    {
      id,
      farmId: device.farm_id,
      configVersion: config.version,
      metric: pair.metric,
      unit: pair.unit,
    },
    "OPENED",
    stale ? "STALE_TIMEOUT" : "THRESHOLD",
    actorId,
    reading,
    now,
  );
  const label = pair.metric.replaceAll("_", " ");
  const description = stale
    ? `${label} · tidak ada bacaan GOOD dalam ${config.stale_after_seconds} detik.`
    : `${label} ${reading?.value ?? "—"} ${pair.unit} · batas ${threshold} ${pair.unit}.`;
  await addOutboxEvent(tx, {
    farmId: device.farm_id,
    eventKey: `iot-alert:${id}`,
    eventType: "IOT_ALERT",
    sourceId: id,
    payload: {
      title: stale
        ? "Bacaan perangkat terlambat"
        : condition === "LOW"
          ? "Nilai perangkat di bawah batas"
          : "Nilai perangkat melewati batas",
      description,
      href: `/devices#device-${device.id}`,
      sourceLabel: `${label} · ${pair.unit}`,
    },
  });
  return id;
}

async function resolveEpisode(
  tx: Sql,
  device: DeviceAlertScope,
  episode: OpenEpisode,
  configVersion: number,
  reason: CloseReason,
  reading: GoodReading | null,
  now: Date,
  actorId: string | null,
  pair: AlertPair,
): Promise<void> {
  const result = await tx.query(
    `UPDATE farm_device_alert_episode
     SET resolved_at=$2::timestamptz,resolved_reason=$3,resolved_by=$4
     WHERE farm_id=$5 AND id=$1 AND resolved_at IS NULL
     RETURNING id`,
    [episode.id, now.toISOString(), reason, actorId, device.farm_id],
  );
  if (!result.rows.length) return;
  await appendTransition(
    tx,
    {
      id: episode.id,
      farmId: device.farm_id,
      configVersion,
      metric: pair.metric,
      unit: pair.unit,
    },
    reason,
    reason,
    actorId,
    reading,
    now,
  );
  await resolveOutboxEvent(tx, device.farm_id, episode.id, now);
}

async function openEpisodes(
  tx: Sql,
  deviceId: string,
  metric: string,
  unit: string,
): Promise<OpenEpisode[]> {
  const result = await tx.query<OpenEpisode>(
    `SELECT id,condition_kind FROM farm_device_alert_episode
     WHERE device_id=$1 AND metric_key=$2 AND measurement_unit=$3
       AND resolved_at IS NULL`,
    [deviceId, metric, unit],
  );
  return result.rows;
}

export async function evaluateThresholdAlerts(
  tx: Sql,
  device: DeviceAlertScope,
  pairs: AlertPair[],
  now: Date,
  actorId: string | null = null,
): Promise<void> {
  for (const pair of pairs) {
    const config = await latestConfig(tx, device.id, pair.metric, pair.unit);
    if (!config) continue;
    const reading = await latestGoodReading(
      tx,
      device.id,
      pair.metric,
      pair.unit,
    );
    const desired = reading
      ? evaluateThreshold(reading.value, configThresholds(config))
      : null;
    for (const episode of await openEpisodes(
      tx,
      device.id,
      pair.metric,
      pair.unit,
    )) {
      if (episode.condition_kind === "STALE") continue;
      if (episode.condition_kind !== desired)
        await resolveEpisode(
          tx,
          device,
          episode,
          config.version,
          "RECOVERED",
          reading,
          now,
          actorId,
          pair,
        );
    }
    if (
      desired &&
      !(await openEpisodes(tx, device.id, pair.metric, pair.unit)).some(
        (episode) => episode.condition_kind === desired,
      )
    )
      await openEpisode(
        tx,
        device,
        pair,
        config,
        desired,
        reading,
        now,
        actorId,
      );
  }
}

export async function closeDeviceAlertEpisodes(
  tx: Sql,
  device: DeviceAlertScope,
  reason: Exclude<CloseReason, "RECOVERED">,
  now: Date,
  actorId: string | null,
  pair?: AlertPair,
): Promise<void> {
  const episodes = await tx.query<{
    id: string;
    metric_key: string;
    measurement_unit: string;
    condition_kind: ThresholdCondition | "STALE";
    config_version: number;
  }>(
    `SELECT id,metric_key,measurement_unit,condition_kind,config_version
     FROM farm_device_alert_episode
     WHERE device_id=$1 AND resolved_at IS NULL
       AND ($2::text IS NULL OR metric_key=$2)
       AND ($3::text IS NULL OR measurement_unit=$3)
     ORDER BY id`,
    [device.id, pair?.metric ?? null, pair?.unit ?? null],
  );
  for (const episode of episodes.rows)
    await resolveEpisode(
      tx,
      device,
      episode,
      episode.config_version,
      reason,
      null,
      now,
      actorId,
      { metric: episode.metric_key, unit: episode.measurement_unit },
    );
}

function metricKey(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value))
    throw new DomainError("VALIDATION");
  return value;
}

export async function setDeviceMetricAlertConfig(
  db: Database,
  context: CommandContext,
  deviceId: string,
  metric: string,
  key: string,
  raw: unknown,
) {
  uuid.parse(deviceId);
  const metricValue = metricKey(metric);
  const input: AlertConfigInput = alertConfigInputSchema.parse(raw);
  const idempotencyKey = uuid.parse(key);
  return command(
    db,
    context,
    "iot.devices.alert-config",
    idempotencyKey,
    { deviceId, metric: metricValue, ...input },
    async (tx) => {
      const device = await tx.query<{
        id: string;
        farm_id: string;
        status: string;
      }>(
        `SELECT id,farm_id,status FROM farm_device
         WHERE farm_id=$1 AND id=$2 FOR UPDATE`,
        [context.farmId, deviceId],
      );
      const row = device.rows[0];
      if (!row) throw new DomainError("NOT_FOUND");
      if (row.status !== "ACTIVE") throw new DomainError("CONFLICT");
      const registered = await tx.query(
        `SELECT 1 FROM farm_device_metric
         WHERE device_id=$1 AND metric_key=$2 AND measurement_unit=$3 AND active=true`,
        [deviceId, metricValue, input.unit],
      );
      if (!registered.rows.length) throw new DomainError("VALIDATION");

      const previous = await latestConfig(
        tx,
        deviceId,
        metricValue,
        input.unit,
      );
      if (
        previous &&
        sameDecimal(previous.low_threshold, input.low) &&
        sameDecimal(previous.high_threshold, input.high) &&
        previous.stale_after_seconds === input.staleAfterSeconds
      )
        return {
          deviceId,
          metric: metricValue,
          unit: input.unit,
          version: previous.version,
          low: previous.low_threshold,
          high: previous.high_threshold,
          staleAfterSeconds: previous.stale_after_seconds,
          changedBy: previous.changed_by,
          changedAt: previous.created_at,
        };
      const version = (previous?.version ?? 0) + 1;
      const configResult = await tx.query<
        ConfigRow & {
          low_threshold: string | null;
          high_threshold: string | null;
        }
      >(
        `INSERT INTO farm_device_alert_config
           (device_id,metric_key,measurement_unit,version,low_threshold,
            high_threshold,stale_after_seconds,changed_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING version,low_threshold::text AS low_threshold,
           high_threshold::text AS high_threshold,stale_after_seconds,changed_by,
           created_at::text AS created_at`,
        [
          deviceId,
          metricValue,
          input.unit,
          version,
          input.low,
          input.high,
          input.staleAfterSeconds,
          context.actorId,
        ],
      );
      const config = configResult.rows[0];
      if (!config) throw new DomainError("INTERNAL");
      await closeDeviceAlertEpisodes(
        tx,
        { id: row.id, farm_id: row.farm_id },
        "CONFIG_CHANGED",
        new Date(config.created_at),
        context.actorId,
        { metric: metricValue, unit: input.unit },
      );
      await evaluateThresholdAlerts(
        tx,
        { id: row.id, farm_id: row.farm_id },
        [{ metric: metricValue, unit: input.unit }],
        new Date(config.created_at),
        context.actorId,
      );
      return {
        deviceId,
        metric: metricValue,
        unit: input.unit,
        version: config.version,
        low: config.low_threshold,
        high: config.high_threshold,
        staleAfterSeconds: config.stale_after_seconds,
        changedBy: config.changed_by,
        changedAt: config.created_at,
      };
    },
  );
}

export async function materializeStaleAlerts(
  tx: Sql,
  now: Date,
): Promise<number> {
  const devices = await tx.query<{ id: string; farm_id: string }>(
    `SELECT d.id,d.farm_id FROM farm_device d
     WHERE d.status='ACTIVE' AND EXISTS (
       SELECT 1 FROM farm_device_metric m
       JOIN farm_device_alert_config c
         ON c.device_id=m.device_id AND c.metric_key=m.metric_key
          AND c.measurement_unit=m.measurement_unit
       WHERE m.device_id=d.id AND m.active=true AND c.stale_after_seconds IS NOT NULL
         AND c.version=(SELECT max(latest.version) FROM farm_device_alert_config latest
           WHERE latest.device_id=c.device_id AND latest.metric_key=c.metric_key
             AND latest.measurement_unit=c.measurement_unit)
     )
      ORDER BY d.stale_alert_checked_at ASC NULLS FIRST,d.id
      LIMIT 100 FOR UPDATE OF d SKIP LOCKED`,
  );
  let opened = 0;
  for (const device of devices.rows) {
    const configs = await tx.query<{
      metric_key: string;
      measurement_unit: string;
      version: number;
      low_threshold: string | null;
      high_threshold: string | null;
      stale_after_seconds: number;
      changed_by: string;
      created_at: string;
    }>(
      `SELECT c.metric_key,c.measurement_unit,c.version,
         c.low_threshold::text AS low_threshold,c.high_threshold::text AS high_threshold,
         c.stale_after_seconds,c.changed_by,c.created_at::text AS created_at
       FROM farm_device_metric m
       JOIN farm_device_alert_config c
         ON c.device_id=m.device_id AND c.metric_key=m.metric_key
          AND c.measurement_unit=m.measurement_unit
       WHERE m.device_id=$1 AND m.active=true AND c.stale_after_seconds IS NOT NULL
         AND c.version=(SELECT max(latest.version) FROM farm_device_alert_config latest
           WHERE latest.device_id=c.device_id AND latest.metric_key=c.metric_key
             AND latest.measurement_unit=c.measurement_unit)
       ORDER BY c.metric_key,c.measurement_unit`,
      [device.id],
    );
    for (const config of configs.rows) {
      const pair = { metric: config.metric_key, unit: config.measurement_unit };
      const reading = await latestGoodReading(
        tx,
        device.id,
        pair.metric,
        pair.unit,
      );
      const baseline = reading?.observed_at ?? config.created_at;
      const elapsed = now.getTime() - new Date(baseline).getTime();
      const stale = elapsed >= config.stale_after_seconds * 1000;
      const open = (
        await openEpisodes(tx, device.id, pair.metric, pair.unit)
      ).find((episode) => episode.condition_kind === "STALE");
      if (stale && !open) {
        await openEpisode(
          tx,
          device,
          pair,
          config,
          "STALE",
          reading,
          now,
          null,
        );
        opened += 1;
      } else if (!stale && open) {
        await resolveEpisode(
          tx,
          device,
          open,
          config.version,
          "RECOVERED",
          reading,
          now,
          null,
          pair,
        );
      }
    }
    await tx.query(
      `UPDATE farm_device SET stale_alert_checked_at=clock_timestamp()
       WHERE id=$1`,
      [device.id],
    );
  }
  return opened;
}

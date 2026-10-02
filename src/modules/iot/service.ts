import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { CommandContext } from "../../shared/domain.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import { command, commandWithOneTimeSecret } from "../../server/command.js";
import type { Database, Sql } from "../../server/db.js";
import {
  deviceCreateInputSchema,
  deviceMetricsInputSchema,
  deviceRenameInputSchema,
} from "./contracts.js";
import type { DeviceMetricsInput } from "./contracts.js";
import {
  closeDeviceAlertEpisodes,
  evaluateThresholdAlerts,
} from "./alerts.js";

type DeviceSecretReceipt = {
  deviceId: string;
  name: string;
  farmUnitId: string;
  status: "ACTIVE";
};

type OneTimeToken = { token: string };

type OneTimeSecretOutcome<TReceipt> = {
  receipt: TReceipt;
  firstResponse: OneTimeToken | null;
  replayed: boolean;
};

function secretResult(outcome: OneTimeSecretOutcome<DeviceSecretReceipt>) {
  return {
    ...outcome.receipt,
    token: outcome.firstResponse?.token ?? null,
    secretIssued: outcome.firstResponse !== null,
  };
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function appendDeviceEvent(
  tx: Sql,
  context: CommandContext,
  deviceId: string,
  eventType:
    | "CREATED"
    | "RENAMED"
    | "METRIC_ACTIVATED"
    | "METRIC_RETIRED"
    | "TOKEN_ROTATED"
    | "REVOKED",
  metadata: Record<string, unknown>,
): Promise<void> {
  await tx.query(
    `INSERT INTO farm_device_event
       (id,device_id,farm_id,actor_id,event_type,metadata)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [
      randomUUID(),
      deviceId,
      context.farmId,
      context.actorId,
      eventType,
      JSON.stringify(metadata),
    ],
  );
}

export async function createDevice(
  db: Database,
  context: CommandContext,
  key: string,
  raw: unknown,
) {
  const input = deviceCreateInputSchema.parse(raw);
  const idempotencyKey = uuid.parse(key);
  const token = randomBytes(32).toString("base64url");
  const outcome = await commandWithOneTimeSecret<
    DeviceSecretReceipt,
    OneTimeToken
  >(db, context, "iot.devices.create", idempotencyKey, input, async (tx) => {
    const unit = await tx.query<{ id: string }>(
      "SELECT id FROM farm_unit WHERE farm_id=$1 AND id=$2",
      [context.farmId, input.farmUnitId],
    );
    if (!unit.rows[0]) throw new DomainError("NOT_FOUND");

    const deviceId = randomUUID();
    await tx.query(
      `INSERT INTO farm_device
           (id,farm_id,farm_unit_id,label,token_hash,created_by,changed_by)
         VALUES($1,$2,$3,$4,$5,$6,$6)`,
      [
        deviceId,
        context.farmId,
        input.farmUnitId,
        input.name,
        tokenHash(token),
        context.actorId,
      ],
    );
    for (const metric of input.metrics) {
      await tx.query(
        `INSERT INTO farm_device_metric
             (device_id,metric_key,measurement_unit,active,changed_by)
           VALUES($1,$2,$3,true,$4)`,
        [deviceId, metric.metric, metric.unit, context.actorId],
      );
    }
    await appendDeviceEvent(tx, context, deviceId, "CREATED", {
      name: input.name,
      farmUnitId: input.farmUnitId,
      metrics: input.metrics,
    });
    return {
      receipt: {
        deviceId,
        name: input.name,
        farmUnitId: input.farmUnitId,
        status: "ACTIVE",
      },
      firstResponse: { token },
    };
  });
  return secretResult(outcome);
}

export async function renameDevice(
  db: Database,
  context: CommandContext,
  deviceId: string,
  key: string,
  raw: unknown,
) {
  uuid.parse(deviceId);
  const input = deviceRenameInputSchema.parse(raw);
  const idempotencyKey = uuid.parse(key);
  return command(
    db,
    context,
    "iot.devices.rename",
    idempotencyKey,
    input,
    async (tx) => {
      const device = await tx.query<{ id: string }>(
        "SELECT id FROM farm_device WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, deviceId],
      );
      if (!device.rows[0]) throw new DomainError("NOT_FOUND");
      await tx.query(
        `UPDATE farm_device SET label=$3,changed_by=$4,changed_at=clock_timestamp()
         WHERE farm_id=$1 AND id=$2`,
        [context.farmId, deviceId, input.name, context.actorId],
      );
      await appendDeviceEvent(tx, context, deviceId, "RENAMED", {
        name: input.name,
      });
      return { deviceId, name: input.name };
    },
  );
}

export async function setDeviceMetrics(
  db: Database,
  context: CommandContext,
  deviceId: string,
  key: string,
  raw: unknown,
) {
  uuid.parse(deviceId);
  const input: DeviceMetricsInput = deviceMetricsInputSchema.parse(raw);
  const idempotencyKey = uuid.parse(key);
  return command(
    db,
    context,
    "iot.devices.metrics",
    idempotencyKey,
    input,
    async (tx) => {
      const device = await tx.query<{ id: string }>(
        "SELECT id FROM farm_device WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, deviceId],
      );
      if (!device.rows[0]) throw new DomainError("NOT_FOUND");
      const requestedMetrics = new Set(
        input.metrics.map((metric) => `${metric.metric}\u0000${metric.unit}`),
      );
      const existingMetrics = await tx.query<{
        metric_key: string;
        measurement_unit: string;
        active: boolean;
      }>(
        `SELECT metric_key,measurement_unit,active FROM farm_device_metric
         WHERE device_id=$1 FOR UPDATE`,
        [deviceId],
      );
      const previousState = new Map<string, boolean>(
        existingMetrics.rows.map((metric) => [
          `${metric.metric_key}\u0000${metric.measurement_unit}`,
          metric.active,
        ] as const),
      );
      for (const metric of existingMetrics.rows) {
        if (!metric.active) continue;
        if (
          requestedMetrics.has(
            `${metric.metric_key}\u0000${metric.measurement_unit}`,
          )
        )
          continue;
        await tx.query(
          `UPDATE farm_device_metric
           SET active=false,changed_by=$2,changed_at=clock_timestamp()
           WHERE device_id=$1 AND metric_key=$3 AND measurement_unit=$4`,
          [
            deviceId,
            context.actorId,
            metric.metric_key,
            metric.measurement_unit,
          ],
        );
        await appendDeviceEvent(tx, context, deviceId, "METRIC_RETIRED", {
          metric: metric.metric_key,
          unit: metric.measurement_unit,
        });
        await closeDeviceAlertEpisodes(
          tx,
          { id: deviceId, farm_id: context.farmId },
          "METRIC_DISABLED",
          new Date(),
          context.actorId,
          { metric: metric.metric_key, unit: metric.measurement_unit },
        );
      }
      for (const metric of input.metrics) {
        await tx.query(
          `INSERT INTO farm_device_metric
             (device_id,metric_key,measurement_unit,active,changed_by)
           VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(device_id,metric_key,measurement_unit) DO UPDATE
             SET active=EXCLUDED.active,changed_by=EXCLUDED.changed_by,
                 changed_at=clock_timestamp()`,
          [
            deviceId,
            metric.metric,
            metric.unit,
            metric.active,
            context.actorId,
          ],
        );
        await appendDeviceEvent(
          tx,
          context,
          deviceId,
          metric.active ? "METRIC_ACTIVATED" : "METRIC_RETIRED",
          { metric: metric.metric, unit: metric.unit },
        );
        if (!metric.active)
          await closeDeviceAlertEpisodes(
            tx,
            { id: deviceId, farm_id: context.farmId },
            "METRIC_DISABLED",
            new Date(),
            context.actorId,
            { metric: metric.metric, unit: metric.unit },
          );
        else if (
          previousState.get(`${metric.metric}\u0000${metric.unit}`) === false
        )
          await evaluateThresholdAlerts(
            tx,
            { id: deviceId, farm_id: context.farmId },
            [{ metric: metric.metric, unit: metric.unit }],
            new Date(),
            context.actorId,
          );
      }
      return { deviceId, metrics: input.metrics };
    },
  );
}

export async function rotateDeviceToken(
  db: Database,
  context: CommandContext,
  deviceId: string,
  key: string,
) {
  uuid.parse(deviceId);
  const idempotencyKey = uuid.parse(key);
  const token = randomBytes(32).toString("base64url");
  const outcome = await commandWithOneTimeSecret<
    DeviceSecretReceipt,
    OneTimeToken
  >(
    db,
    context,
    "iot.devices.rotate-token",
    idempotencyKey,
    { deviceId },
    async (tx) => {
      const device = await tx.query<{
        label: string;
        farm_unit_id: string;
        status: "ACTIVE" | "REVOKED";
      }>(
        "SELECT label,farm_unit_id,status FROM farm_device WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, deviceId],
      );
      if (!device.rows[0]) throw new DomainError("NOT_FOUND");
      if (device.rows[0].status !== "ACTIVE") throw new DomainError("CONFLICT");
      await tx.query(
        `UPDATE farm_device SET token_hash=$3,changed_by=$4,changed_at=clock_timestamp()
         WHERE farm_id=$1 AND id=$2`,
        [context.farmId, deviceId, tokenHash(token), context.actorId],
      );
      await appendDeviceEvent(tx, context, deviceId, "TOKEN_ROTATED", {});
      return {
        receipt: {
          deviceId,
          name: device.rows[0].label,
          farmUnitId: device.rows[0].farm_unit_id,
          status: "ACTIVE",
        },
        firstResponse: { token },
      };
    },
  );
  return secretResult(outcome);
}

export async function revokeDevice(
  db: Database,
  context: CommandContext,
  deviceId: string,
  key: string,
) {
  uuid.parse(deviceId);
  const idempotencyKey = uuid.parse(key);
  return command(
    db,
    context,
    "iot.devices.revoke",
    idempotencyKey,
    { deviceId },
    async (tx) => {
      const device = await tx.query<{
        status: "ACTIVE" | "REVOKED";
      }>(
        "SELECT status FROM farm_device WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, deviceId],
      );
      if (!device.rows[0]) throw new DomainError("NOT_FOUND");
      if (device.rows[0].status === "ACTIVE") {
        await tx.query(
          `UPDATE farm_device
           SET status='REVOKED',revoked_by=$3,revoked_at=clock_timestamp(),
               changed_by=$3,changed_at=clock_timestamp()
           WHERE farm_id=$1 AND id=$2`,
          [context.farmId, deviceId, context.actorId],
        );
        await closeDeviceAlertEpisodes(
          tx,
          { id: deviceId, farm_id: context.farmId },
          "DEVICE_REVOKED",
          new Date(),
          context.actorId,
        );
        await appendDeviceEvent(tx, context, deviceId, "REVOKED", {});
      }
      return { deviceId, status: "REVOKED" as const };
    },
  );
}

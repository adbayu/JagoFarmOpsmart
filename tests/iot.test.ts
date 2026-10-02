import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../src/server/app.js";
import { createLocalAuth } from "../src/server/identity.js";
import type { Database } from "../src/server/db.js";
import { runTelemetryRetentionTick } from "../src/modules/iot/retention.js";
import { startTelemetryRetentionWorker } from "../src/modules/iot/retention.js";
import { fixture } from "./fixture.js";
import {
  createDevice,
  renameDevice,
  revokeDevice,
  rotateDeviceToken,
  setDeviceMetrics,
} from "../src/modules/iot/service.js";
import { setDeviceMetricAlertConfig } from "../src/modules/iot/alerts.js";
import { listDevices } from "../src/modules/iot/queries.js";
import { latestTelemetryReading } from "../src/modules/iot/queries.js";
import {
  authenticateAndConsumeRateLimit,
  ingestReadings,
} from "../src/modules/iot/ingest.js";
import {
  canonicalDecimal,
  readingBatchSchema,
  readingInputSchema,
  validateObservedAt,
} from "../src/modules/iot/contracts.js";

const validReading = {
  reading_id: "gateway-7:98211",
  metric: "water_temperature",
  unit: "degC",
  value: "24.125",
  observed_at: "2026-10-01T09:00:00+07:00",
};

let registrySql: PGlite;
let registryDb: Database;
let registryFarm: Awaited<ReturnType<typeof fixture>>;
const apiOrigin = "http://127.0.0.1:5173";

before(async () => {
  registrySql = new PGlite();
  for (const name of (await readdir("db/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await registrySql.exec(await readFile(`db/migrations/${name}`, "utf8"));
  registryFarm = await fixture(registrySql);
  registryDb = {
    transaction: (work) => registrySql.transaction((tx) => work(tx)),
  };
});

after(async () => {
  await registrySql.close();
});

function registryContext(
  farmId = registryFarm.farmId,
  actorId = registryFarm.actorId,
) {
  return { farmId, actorId };
}

function createInput(
  overrides: Partial<{
    name: string;
    farmUnitId: string;
    metrics: { metric: string; unit: string }[];
  }> = {},
) {
  return {
    name: "Kolam sensor",
    farmUnitId: registryFarm.unitId,
    metrics: [{ metric: "water_temperature", unit: "degC" }],
    ...overrides,
  };
}

async function createTestDevice(metric = "water_temperature") {
  return createDevice(
    registryDb,
    registryContext(),
    randomUUID(),
    createInput({ metrics: [{ metric, unit: "degC" }] }),
  );
}

function reading(
  overrides: Partial<typeof validReading> & { quality?: string } = {},
) {
  return {
    ...validReading,
    observed_at: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

async function authorizeIngest(token: string) {
  const middleware = authenticateAndConsumeRateLimit(registryDb);
  return new Promise<unknown>((resolve) => {
    void middleware(
      { get: () => `Bearer ${token}` } as never,
      { locals: {} } as never,
      (error) => resolve(error ?? null),
    );
  });
}

async function rateTokens(deviceId: string) {
  const result = await registrySql.query<{ tokens: string }>(
    "SELECT rate_limit_tokens::text AS tokens FROM farm_device WHERE id=$1",
    [deviceId],
  );
  return Number(result.rows[0]?.tokens);
}

function httpApi(
  resolveIdentity: (
    request: import("express").Request,
  ) => Promise<{ userId: string } | null> = async () => ({
    userId: registryFarm.actorId,
  }),
  auth?: ReturnType<typeof createLocalAuth>,
) {
  const server = createApp(registryDb, resolveIdentity, auth).listen(
    0,
    "127.0.0.1",
  );
  return {
    async request(
      path: string,
      method = "GET",
      body?: unknown,
      headers: Record<string, string> = {},
      rawBody?: string,
    ) {
      if (!server.listening)
        await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const requestBody =
        rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method,
        headers: {
          ...(requestBody === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...headers,
        },
        body: requestBody,
      });
      return {
        status: response.status,
        json: await response.json(),
        retryAfter: response.headers.get("retry-after"),
        cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
      };
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

test("acceptsReadingBatchWithinBounds", () => {
  const atMinimum = Array.from({ length: 1 }, (_, index) => ({
    ...validReading,
    reading_id: `minimum-${index}`,
  }));
  const atMaximum = Array.from({ length: 100 }, (_, index) => ({
    ...validReading,
    reading_id: `maximum-${index}`,
  }));

  assert.equal(
    readingBatchSchema.safeParse({ readings: atMinimum }).success,
    true,
  );
  assert.equal(
    readingBatchSchema.safeParse({ readings: atMaximum }).success,
    true,
  );
});

test("acceptsInclusiveTimestampBoundsAndRejectsOutside", () => {
  const now = new Date("2026-10-02T00:00:00.000Z");

  assert.equal(
    validateObservedAt("2026-07-04T00:00:00.000Z", now).toISOString(),
    "2026-07-04T00:00:00.000Z",
  );
  assert.equal(
    validateObservedAt("2026-10-02T00:05:00.000Z", now).toISOString(),
    "2026-10-02T00:05:00.000Z",
  );
  assert.throws(() => validateObservedAt("2026-07-03T23:59:59.999Z", now));
  assert.throws(() => validateObservedAt("2026-10-02T00:05:00.001Z", now));
});

test("rejectsMalformedOrOversizedBatch", () => {
  assert.equal(readingBatchSchema.safeParse({ readings: [] }).success, false);
  assert.equal(
    readingBatchSchema.safeParse({
      readings: Array.from({ length: 101 }, (_, index) => ({
        ...validReading,
        reading_id: `too-many-${index}`,
      })),
    }).success,
    false,
  );
  assert.equal(
    readingBatchSchema.safeParse({
      readings: [{ ...validReading, value: 24.125 }],
    }).success,
    false,
  );
});

test("rejectsTenantAuthorityFields", () => {
  for (const field of ["farm_id", "farm_unit_id", "device_id", "received_at"]) {
    assert.equal(
      readingInputSchema.safeParse({ ...validReading, [field]: "forged" })
        .success,
      false,
      `${field} must not be accepted from a device`,
    );
  }
});

test("acceptsDecimalPrecisionAndRejectsOverflow", () => {
  assert.equal(
    readingInputSchema.safeParse({
      ...validReading,
      value: "999999999999.123456",
    }).success,
    true,
  );
  assert.equal(
    readingInputSchema.safeParse({
      ...validReading,
      value: "1000000000000",
    }).success,
    false,
  );
  assert.equal(
    readingInputSchema.safeParse({
      ...validReading,
      value: "1.1234567",
    }).success,
    false,
  );
});

test("normalizesDecimalWithoutFloatingPoint", () => {
  assert.equal(canonicalDecimal("24.125000"), "24.125");
  assert.equal(canonicalDecimal("-0.000000"), "0");
  assert.equal(canonicalDecimal("0.000100"), "0.0001");
  assert.equal(canonicalDecimal("900719925474.000001"), "900719925474.000001");
});

test("requiresOffsetTimestamp", () => {
  assert.equal(
    readingInputSchema.safeParse({
      ...validReading,
      observed_at: "2026-10-01T09:00:00Z",
    }).success,
    true,
  );
  assert.equal(
    readingInputSchema.safeParse({
      ...validReading,
      observed_at: "2026-10-01T09:00:00",
    }).success,
    false,
  );
  assert.equal(
    readingInputSchema.safeParse({
      ...validReading,
      observed_at: "2026-02-30T09:00:00Z",
    }).success,
    false,
  );
});

test("defaultsQualityToGood", () => {
  const parsed = readingInputSchema.parse(validReading);
  assert.equal(parsed.quality, "GOOD");
});

test("rejectsUnknownQuality", () => {
  assert.equal(
    readingInputSchema.safeParse({ ...validReading, quality: "EXCELLENT" })
      .success,
    false,
  );
});

test("migration constrains tenant bindings, registered metrics, enums, idempotency and purge", async () => {
  const sql = new PGlite();
  try {
    const migrations = (await readdir("db/migrations"))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const name of migrations)
      await sql.exec(await readFile(`db/migrations/${name}`, "utf8"));

    const firstFarm = await fixture(sql);
    const otherFarm = await fixture(sql);
    const deviceId = randomUUID();
    await sql.query(
      `INSERT INTO farm_device
         (id,farm_id,farm_unit_id,label,token_hash,created_by,changed_by)
       VALUES($1,$2,$3,$4,$5,$6,$6)`,
      [
        deviceId,
        firstFarm.farmId,
        firstFarm.unitId,
        "Sensor kolam",
        "a".repeat(64),
        firstFarm.actorId,
      ],
    );
    await sql.query(
      `INSERT INTO farm_device_metric
         (device_id,metric_key,measurement_unit,active,changed_by)
       VALUES($1,'water_temperature','degC',true,$2)`,
      [deviceId, firstFarm.actorId],
    );

    await assert.rejects(
      sql.query(
        `INSERT INTO farm_device
           (id,farm_id,farm_unit_id,label,token_hash,created_by,changed_by)
         VALUES($1,$2,$3,$4,$5,$6,$6)`,
        [
          randomUUID(),
          firstFarm.farmId,
          otherFarm.unitId,
          "Cross-farm",
          "b".repeat(64),
          firstFarm.actorId,
        ],
      ),
    );
    await assert.rejects(
      sql.query(
        `INSERT INTO telemetry_reading
           (id,device_id,farm_id,farm_unit_id,reading_id,metric_key,measurement_unit,value,observed_at)
         VALUES($1,$2,$3,$4,'unregistered','salinity','ppt',30,'2026-10-01T00:00:00Z')`,
        [randomUUID(), deviceId, firstFarm.farmId, firstFarm.unitId],
      ),
    );
    await assert.rejects(
      sql.query(
        `INSERT INTO farm_device
           (id,farm_id,farm_unit_id,label,token_hash,status,created_by,changed_by)
         VALUES($1,$2,$3,$4,$5,'PAUSED',$6,$6)`,
        [
          randomUUID(),
          firstFarm.farmId,
          firstFarm.unitId,
          "Bad status",
          "c".repeat(64),
          firstFarm.actorId,
        ],
      ),
    );

    const readingId = randomUUID();
    await sql.query(
      `INSERT INTO telemetry_reading
         (id,device_id,farm_id,farm_unit_id,reading_id,metric_key,measurement_unit,value,observed_at,received_at)
       VALUES($1,$2,$3,$4,'reading-1','water_temperature','degC',24.125,now()-interval '1 day',now()-interval '100 days')`,
      [readingId, deviceId, firstFarm.farmId, firstFarm.unitId],
    );
    await sql.query(
      `INSERT INTO telemetry_reading
         (id,device_id,farm_id,farm_unit_id,reading_id,metric_key,measurement_unit,value,observed_at,received_at)
       VALUES($1,$2,$3,$4,'reading-2','water_temperature','degC',24.125,now()-interval '1 day',now()-interval '100 days')`,
      [randomUUID(), deviceId, firstFarm.farmId, firstFarm.unitId],
    );
    await assert.rejects(
      sql.query(
        `INSERT INTO telemetry_reading
           (id,device_id,farm_id,farm_unit_id,reading_id,metric_key,measurement_unit,value,observed_at)
         VALUES($1,$2,$3,$4,'reading-1','water_temperature','degC',24.125,'2026-10-01T00:00:00Z')`,
        [randomUUID(), deviceId, firstFarm.farmId, firstFarm.unitId],
      ),
    );
    await assert.rejects(
      sql.query(
        `INSERT INTO telemetry_reading
           (id,device_id,farm_id,farm_unit_id,reading_id,metric_key,measurement_unit,value,observed_at,quality)
         VALUES($1,$2,$3,$4,'bad-quality','water_temperature','degC',24.125,'2026-10-01T00:00:00Z','EXCELLENT')`,
        [randomUUID(), deviceId, firstFarm.farmId, firstFarm.unitId],
      ),
    );

    await sql.query(
      `INSERT INTO telemetry_reading
         (id,device_id,farm_id,farm_unit_id,reading_id,metric_key,measurement_unit,value,observed_at)
       VALUES($1,$2,$3,$4,'fresh','water_temperature','degC',24.125,'2026-10-01T00:00:00Z')`,
      [randomUUID(), deviceId, firstFarm.farmId, firstFarm.unitId],
    );
    const purged = await sql.query<{ count: number }>(
      "SELECT purge_expired_telemetry(1) AS count",
    );
    assert.equal(Number(purged.rows[0]?.count), 1);
    const afterFirstBatch = await sql.query<{ reading_id: string }>(
      "SELECT reading_id FROM telemetry_reading ORDER BY reading_id",
    );
    assert.deepEqual(
      afterFirstBatch.rows.map((row) => row.reading_id),
      ["fresh", "reading-2"],
    );
    const secondPurge = await sql.query<{ count: number }>(
      "SELECT purge_expired_telemetry(1000) AS count",
    );
    assert.equal(Number(secondPurge.rows[0]?.count), 1);
    const emptyPurge = await sql.query<{ count: number }>(
      "SELECT purge_expired_telemetry(1000) AS count",
    );
    assert.equal(Number(emptyPurge.rows[0]?.count), 0);
    await assert.rejects(sql.query("SELECT purge_expired_telemetry(0)"));
    await assert.rejects(sql.query("SELECT purge_expired_telemetry(1001)"));
    const remaining = await sql.query<{ reading_id: string }>(
      "SELECT reading_id FROM telemetry_reading ORDER BY reading_id",
    );
    assert.deepEqual(
      remaining.rows.map((row) => row.reading_id),
      ["fresh"],
    );
  } finally {
    await sql.close();
  }
});

test("createDeviceStoresOnlyHash", async () => {
  const result = await createDevice(
    registryDb,
    registryContext(),
    randomUUID(),
    createInput(),
  );
  assert.ok(result.token);
  assert.equal(result.secretIssued, true);
  assert.equal(result.token!.length, 43);
  const stored = await registrySql.query<{ token_hash: string }>(
    "SELECT token_hash FROM farm_device WHERE id=$1",
    [result.deviceId],
  );
  assert.equal(
    stored.rows[0]?.token_hash,
    createHash("sha256").update(result.token!).digest("hex"),
  );
  assert.notEqual(stored.rows[0]?.token_hash, result.token);
});

test("createDeviceBindsUnitFromSameFarm", async () => {
  const device = await createDevice(
    registryDb,
    registryContext(),
    randomUUID(),
    createInput(),
  );
  const binding = await registrySql.query<{
    farm_id: string;
    farm_unit_id: string;
  }>("SELECT farm_id,farm_unit_id FROM farm_device WHERE id=$1", [
    device.deviceId,
  ]);
  assert.deepEqual(binding.rows[0], {
    farm_id: registryFarm.farmId,
    farm_unit_id: registryFarm.unitId,
  });

  const foreignFarm = await fixture(registrySql);
  await assert.rejects(
    createDevice(
      registryDb,
      registryContext(),
      randomUUID(),
      createInput({ farmUnitId: foreignFarm.unitId }),
    ),
  );
});

test("renameDeviceAppendsEvent", async () => {
  const device = await createDevice(
    registryDb,
    registryContext(),
    randomUUID(),
    createInput(),
  );
  await renameDevice(
    registryDb,
    registryContext(),
    device.deviceId,
    randomUUID(),
    { name: "Kolam utara" },
  );
  const events = await registrySql.query<{
    event_type: string;
    actor_id: string;
    metadata: { name?: string };
  }>(
    "SELECT event_type,actor_id,metadata FROM farm_device_event WHERE device_id=$1 ORDER BY occurred_at,id",
    [device.deviceId],
  );
  assert.equal(events.rows.length, 2);
  assert.equal(events.rows[1]?.event_type, "RENAMED");
  assert.equal(events.rows[1]?.actor_id, registryFarm.actorId);
  assert.equal(events.rows[1]?.metadata.name, "Kolam utara");
});

test("metricRetirementKeepsReadings", async () => {
  const device = await createDevice(
    registryDb,
    registryContext(),
    randomUUID(),
    createInput(),
  );
  await registrySql.query(
    `INSERT INTO telemetry_reading
       (id,device_id,farm_id,farm_unit_id,reading_id,metric_key,measurement_unit,value,observed_at)
     VALUES($1,$2,$3,$4,'before-retirement','water_temperature','degC',24.125,now())`,
    [randomUUID(), device.deviceId, registryFarm.farmId, registryFarm.unitId],
  );
  await setDeviceMetrics(
    registryDb,
    registryContext(),
    device.deviceId,
    randomUUID(),
    { metrics: [{ metric: "water_temperature", unit: "degC", active: false }] },
  );
  const reading = await registrySql.query(
    "SELECT id FROM telemetry_reading WHERE device_id=$1 AND reading_id='before-retirement'",
    [device.deviceId],
  );
  const metric = await registrySql.query<{ active: boolean }>(
    "SELECT active FROM farm_device_metric WHERE device_id=$1 AND metric_key='water_temperature' AND measurement_unit='degC'",
    [device.deviceId],
  );
  assert.equal(reading.rows.length, 1);
  assert.equal(metric.rows[0]?.active, false);
});

test("omittedActiveMetricIsRetiredAndHistoryIsKept", async () => {
  const device = await createDevice(
    registryDb,
    registryContext(),
    randomUUID(),
    createInput(),
  );
  await registrySql.query(
    `INSERT INTO telemetry_reading
       (id,device_id,farm_id,farm_unit_id,reading_id,metric_key,measurement_unit,value,observed_at)
     VALUES($1,$2,$3,$4,'before-omission','water_temperature','degC',24.125,now())`,
    [randomUUID(), device.deviceId, registryFarm.farmId, registryFarm.unitId],
  );

  await setDeviceMetrics(
    registryDb,
    registryContext(),
    device.deviceId,
    randomUUID(),
    {
      metrics: [{ metric: "dissolved_oxygen", unit: "mg/L", active: true }],
    },
  );

  const metrics = await registrySql.query<{
    metric_key: string;
    active: boolean;
  }>(
    "SELECT metric_key,active FROM farm_device_metric WHERE device_id=$1 ORDER BY metric_key",
    [device.deviceId],
  );
  const historical = await registrySql.query(
    "SELECT id FROM telemetry_reading WHERE device_id=$1 AND reading_id='before-omission'",
    [device.deviceId],
  );
  const retiredEvent = await registrySql.query(
    `SELECT id FROM farm_device_event
     WHERE device_id=$1 AND event_type='METRIC_RETIRED'
       AND metadata->>'metric'='water_temperature'`,
    [device.deviceId],
  );
  assert.deepEqual(metrics.rows, [
    { metric_key: "dissolved_oxygen", active: true },
    { metric_key: "water_temperature", active: false },
  ]);
  assert.equal(historical.rows.length, 1);
  assert.equal(retiredEvent.rows.length, 1);
});

test("rotateTokenInvalidatesOldToken", async () => {
  const device = await createDevice(
    registryDb,
    registryContext(),
    randomUUID(),
    createInput(),
  );
  const oldHash = createHash("sha256").update(device.token!).digest("hex");
  const rotated = await rotateDeviceToken(
    registryDb,
    registryContext(),
    device.deviceId,
    randomUUID(),
  );
  const newHash = createHash("sha256").update(rotated.token!).digest("hex");
  const stored = await registrySql.query<{ token_hash: string }>(
    "SELECT token_hash FROM farm_device WHERE id=$1",
    [device.deviceId],
  );
  assert.notEqual(rotated.token, device.token);
  assert.equal(stored.rows[0]?.token_hash, newHash);
  assert.notEqual(stored.rows[0]?.token_hash, oldHash);
});

test("revokeCannotBeReactivated", async () => {
  const device = await createDevice(
    registryDb,
    registryContext(),
    randomUUID(),
    createInput(),
  );
  await revokeDevice(
    registryDb,
    registryContext(),
    device.deviceId,
    randomUUID(),
  );
  await assert.rejects(
    registrySql.query(
      `UPDATE farm_device
       SET status='ACTIVE',revoked_by=NULL,revoked_at=NULL
       WHERE id=$1`,
      [device.deviceId],
    ),
  );
});

test("sameKeyReplayDoesNotReturnSecret", async () => {
  const key = randomUUID();
  const input = createInput();
  const first = await createDevice(registryDb, registryContext(), key, input);
  const replay = await createDevice(registryDb, registryContext(), key, input);
  assert.ok(first.token);
  assert.equal(replay.deviceId, first.deviceId);
  assert.equal(replay.token, null);
  assert.equal(replay.secretIssued, false);
});

test("sameKeyDifferentPayloadConflicts", async () => {
  const key = randomUUID();
  await createDevice(registryDb, registryContext(), key, createInput());
  await assert.rejects(
    createDevice(
      registryDb,
      registryContext(),
      key,
      createInput({ name: "Nama lain" }),
    ),
  );
});

test("receiptContainsNoRawToken", async () => {
  const device = await createDevice(
    registryDb,
    registryContext(),
    randomUUID(),
    createInput(),
  );
  const receipt = await registrySql.query<{ response: string }>(
    `SELECT response::text AS response FROM command_receipt
     WHERE farm_id=$1 AND operation='iot.devices.create' AND response::text LIKE '%' || $2 || '%'`,
    [registryFarm.farmId, device.token],
  );
  const event = await registrySql.query<{ metadata: string }>(
    `SELECT metadata::text AS metadata FROM farm_device_event
     WHERE device_id=$1 AND metadata::text LIKE '%' || $2 || '%'`,
    [device.deviceId, device.token],
  );
  assert.equal(receipt.rows.length, 0);
  assert.equal(event.rows.length, 0);
});

test("lostSecretCanOnlyBeReplacedByNewRotation", async () => {
  const key = randomUUID();
  const input = createInput();
  const first = await createDevice(registryDb, registryContext(), key, input);
  const replay = await createDevice(registryDb, registryContext(), key, input);
  const rotated = await rotateDeviceToken(
    registryDb,
    registryContext(),
    first.deviceId,
    randomUUID(),
  );
  assert.equal(replay.token, null);
  assert.ok(rotated.token);
  assert.notEqual(rotated.token, first.token);
});

test("listDevices is membership scoped and omits token hashes", async () => {
  const device = await createDevice(
    registryDb,
    registryContext(),
    randomUUID(),
    createInput(),
  );
  const page = await listDevices(
    registryDb,
    registryFarm.actorId,
    registryFarm.farmId,
    {},
  );
  assert.ok(page.items.some((item) => item.id === device.deviceId));
  assert.equal(JSON.stringify(page).includes("token_hash"), false);

  const firstPage = await listDevices(
    registryDb,
    registryFarm.actorId,
    registryFarm.farmId,
    { limit: 1 },
  );
  assert.ok(firstPage.nextCursor);
  const secondPage = await listDevices(
    registryDb,
    registryFarm.actorId,
    registryFarm.farmId,
    { cursor: firstPage.nextCursor!, limit: 1 },
  );
  assert.notEqual(firstPage.items[0]?.id, secondPage.items[0]?.id);

  const foreign = await fixture(registrySql);
  await assert.rejects(
    listDevices(registryDb, foreign.actorId, registryFarm.farmId, {}),
  );
});

test("storesReadingsWithServerReceivedAt", async () => {
  const device = await createTestDevice();
  await ingestReadings(registryDb, device.token!, {
    readings: [reading({ reading_id: "server-time" })],
  });
  const result = await registrySql.query<{ generated: boolean }>(
    `SELECT received_at >= clock_timestamp()-interval '1 minute'
         AND received_at <= clock_timestamp() AS generated
     FROM telemetry_reading WHERE device_id=$1 AND reading_id='server-time'`,
    [device.deviceId],
  );
  assert.equal(result.rows[0]?.generated, true);
});

test("identicalReplayIsDuplicate", async () => {
  const device = await createTestDevice();
  const batch = { readings: [reading({ reading_id: "replay-same" })] };
  const first = await ingestReadings(registryDb, device.token!, batch);
  const replay = await ingestReadings(registryDb, device.token!, batch);
  assert.deepEqual(first.results, [
    { reading_id: "replay-same", status: "stored" },
  ]);
  assert.deepEqual(replay.results, [
    { reading_id: "replay-same", status: "duplicate" },
  ]);
  assert.equal(replay.stored, 0);
  assert.equal(replay.duplicate, 1);
  const rows = await registrySql.query(
    "SELECT id FROM telemetry_reading WHERE device_id=$1 AND reading_id='replay-same'",
    [device.deviceId],
  );
  assert.equal(rows.rows.length, 1);
});

test("conflictingReadingIdRollsBackButConsumesRateToken", async () => {
  const device = await createTestDevice();
  await ingestReadings(registryDb, device.token!, {
    readings: [reading({ reading_id: "conflict-id", value: "24" })],
  });
  const authorizationError = await authorizeIngest(device.token!);
  assert.equal(authorizationError, null);
  const tokensAfterAuthentication = await rateTokens(device.deviceId);
  await assert.rejects(
    ingestReadings(registryDb, device.token!, {
      readings: [
        reading({ reading_id: "should-rollback", value: "26" }),
        reading({ reading_id: "conflict-id", value: "25" }),
      ],
    }),
  );
  assert.equal(await rateTokens(device.deviceId), tokensAfterAuthentication);
  assert.ok(tokensAfterAuthentication < 120);
  const rows = await registrySql.query<{ value: string }>(
    "SELECT value::text AS value FROM telemetry_reading WHERE device_id=$1 AND reading_id='conflict-id'",
    [device.deviceId],
  );
  assert.deepEqual(
    rows.rows.map((row) => row.value),
    ["24.000000"],
  );
  const rolledBack = await registrySql.query(
    "SELECT id FROM telemetry_reading WHERE device_id=$1 AND reading_id='should-rollback'",
    [device.deviceId],
  );
  assert.equal(rolledBack.rows.length, 0);
});

test("invalidBatchStoresNothing", async () => {
  const device = await createTestDevice();
  await assert.rejects(
    ingestReadings(registryDb, device.token!, {
      readings: [
        reading({ reading_id: "would-be-first" }),
        reading({
          reading_id: "unknown-metric",
          metric: "salinity",
          unit: "ppt",
        }),
      ],
    }),
  );
  const rows = await registrySql.query(
    "SELECT id FROM telemetry_reading WHERE device_id=$1",
    [device.deviceId],
  );
  assert.equal(rows.rows.length, 0);
});

test("invalidQualityExcludedFromOperationalLatest", async () => {
  const metric = "invalid_quality_temperature";
  const device = await createTestDevice(metric);
  const older = new Date(Date.now() - 120_000).toISOString();
  const newer = new Date(Date.now() - 30_000).toISOString();
  await ingestReadings(registryDb, device.token!, {
    readings: [
      reading({
        reading_id: "good-reading",
        metric,
        observed_at: older,
        value: "20",
      }),
    ],
  });
  await ingestReadings(registryDb, device.token!, {
    readings: [
      reading({
        reading_id: "invalid-reading",
        metric,
        observed_at: newer,
        value: "99",
        quality: "INVALID",
      }),
    ],
  });
  const latest = await latestTelemetryReading(
    registryDb,
    registryFarm.actorId,
    registryFarm.farmId,
    registryFarm.unitId,
    metric,
    "degC",
  );
  assert.equal(latest?.readingId, "good-reading");
  assert.equal(latest?.quality, "GOOD");
});

test("lateReadingRemainsHistorical", async () => {
  const metric = "late_temperature";
  const device = await createTestDevice(metric);
  const latestTime = new Date(Date.now() - 30_000).toISOString();
  const lateTime = new Date(Date.now() - 120_000).toISOString();
  await ingestReadings(registryDb, device.token!, {
    readings: [
      reading({
        reading_id: "newer",
        metric,
        observed_at: latestTime,
        value: "24",
      }),
    ],
  });
  await ingestReadings(registryDb, device.token!, {
    readings: [
      reading({
        reading_id: "late",
        metric,
        observed_at: lateTime,
        value: "19",
      }),
    ],
  });
  const latest = await latestTelemetryReading(
    registryDb,
    registryFarm.actorId,
    registryFarm.farmId,
    registryFarm.unitId,
    metric,
    "degC",
  );
  const rows = await registrySql.query(
    "SELECT id FROM telemetry_reading WHERE device_id=$1",
    [device.deviceId],
  );
  assert.equal(rows.rows.length, 2);
  assert.equal(latest?.readingId, "newer");
});

test("authenticatedRejectionCommitsLimiterState", async () => {
  const device = await createTestDevice();
  const authorizationError = await authorizeIngest(device.token!);
  assert.equal(authorizationError, null);
  const tokensAfterAuthentication = await rateTokens(device.deviceId);
  await assert.rejects(
    ingestReadings(registryDb, device.token!, {
      readings: [
        reading({ reading_id: "invalid-after-auth", metric: "missing_metric" }),
      ],
    }),
  );
  assert.equal(await rateTokens(device.deviceId), tokensAfterAuthentication);
  assert.ok(tokensAfterAuthentication < 120);
});

test("memberCanManageFarmDevices", async () => {
  const app = httpApi();
  try {
    const key = randomUUID();
    const created = await app.request(
      `/api/farms/${registryFarm.farmId}/devices`,
      "POST",
      createInput(),
      { "idempotency-key": key },
    );
    assert.equal(created.status, 200);
    assert.equal(created.json.data.secretIssued, true);
    assert.ok(created.json.data.token);
    const list = await app.request(`/api/farms/${registryFarm.farmId}/devices`);
    assert.equal(list.status, 200);
    assert.ok(
      list.json.data.items.some(
        (item: { id: string }) => item.id === created.json.data.deviceId,
      ),
    );
  } finally {
    await app.close();
  }
});

test("deviceMutationRequiresSessionAndCsrf", async () => {
  const auth = createLocalAuth(registryDb, {
    origin: apiOrigin,
    secureCookies: false,
  });
  const app = httpApi(auth.resolveIdentity, auth);
  try {
    const registered = await app.request(
      "/api/auth/register",
      "POST",
      {
        email: `iot-${randomUUID()}@example.test`,
        password: "correct horse battery staple",
        displayName: "IoT Member",
      },
      { origin: apiOrigin },
    );
    assert.equal(registered.status, 200);
    const memberId = registered.json.data.user.id as string;
    await registrySql.query(
      "INSERT INTO farm_membership(farm_id,user_id,added_by) VALUES($1,$2,$3)",
      [registryFarm.farmId, memberId, registryFarm.actorId],
    );
    const path = `/api/farms/${registryFarm.farmId}/devices`;
    const body = createInput();
    const key = randomUUID();

    const noSession = await app.request(path, "POST", body, {
      origin: apiOrigin,
      "idempotency-key": key,
    });
    assert.equal(noSession.status, 401);
    const noCsrf = await app.request(path, "POST", body, {
      origin: apiOrigin,
      "idempotency-key": key,
      cookie: registered.cookie,
    });
    assert.equal(noCsrf.status, 403);
    const valid = await app.request(path, "POST", body, {
      origin: apiOrigin,
      "idempotency-key": key,
      cookie: registered.cookie,
      "x-csrf-token": registered.json.data.csrfToken,
    });
    assert.equal(valid.status, 200);
  } finally {
    await app.close();
  }
});

test("unauthenticatedManagementIsRejected", async () => {
  const app = httpApi(async () => null);
  try {
    const response = await app.request(
      `/api/farms/${registryFarm.farmId}/devices`,
    );
    assert.equal(response.status, 401);
    assert.equal(response.json.error.code, "UNAUTHORIZED");
  } finally {
    await app.close();
  }
});

test("foreignFarmIsDeniedWithoutDetails", async () => {
  const foreignFarm = await fixture(registrySql);
  const app = httpApi();
  try {
    const response = await app.request(
      `/api/farms/${foreignFarm.farmId}/devices`,
    );
    assert.equal(response.status, 403);
    assert.equal(response.json.error.code, "FORBIDDEN");
    assert.equal(
      JSON.stringify(response.json).includes(foreignFarm.farmId),
      false,
    );
  } finally {
    await app.close();
  }
});

test("unregisteredMetricReturns422", async () => {
  const device = await createTestDevice();
  const app = httpApi();
  try {
    const response = await app.request(
      "/api/iot/v1/readings",
      "POST",
      {
        readings: [
          reading({
            reading_id: "unregistered-api",
            metric: "salinity",
            unit: "ppt",
          }),
        ],
      },
      { authorization: `Bearer ${device.token}` },
    );
    assert.equal(response.status, 422);
    assert.equal(response.json.error.code, "VALIDATION");
    assert.ok(response.json.error.requestId);
  } finally {
    await app.close();
  }
});

test("revokeStopsIngest", async () => {
  const device = await createTestDevice();
  await revokeDevice(
    registryDb,
    registryContext(),
    device.deviceId,
    randomUUID(),
  );
  const app = httpApi();
  try {
    const response = await app.request(
      "/api/iot/v1/readings",
      "POST",
      { readings: [reading({ reading_id: "after-revoke" })] },
      { authorization: `Bearer ${device.token}` },
    );
    assert.equal(response.status, 401);
    assert.equal(response.json.error.code, "UNAUTHORIZED");
  } finally {
    await app.close();
  }
});

test("unknownIoTRouteReturnsRequestId", async () => {
  const app = httpApi();
  try {
    const response = await app.request(
      `/api/farms/${registryFarm.farmId}/devices/unknown/action`,
    );
    assert.equal(response.status, 404);
    assert.equal(response.json.error.code, "NOT_FOUND");
    assert.ok(response.json.error.requestId);
  } finally {
    await app.close();
  }
});

test("ingestRequiresBearerHeader", async () => {
  const app = httpApi();
  try {
    const response = await app.request("/api/iot/v1/readings", "POST", {
      readings: [reading({ reading_id: "missing-bearer" })],
    });
    assert.equal(response.status, 401);
    assert.equal(response.json.error.code, "UNAUTHORIZED");
  } finally {
    await app.close();
  }
});

test("ingestParserUses128KiBLimit", async () => {
  const device = await createTestDevice();
  const app = httpApi();
  try {
    const payload =
      JSON.stringify({ readings: [reading({ reading_id: "large-valid" })] }) +
      " ".repeat(110 * 1024);
    const response = await app.request(
      "/api/iot/v1/readings",
      "POST",
      undefined,
      { authorization: `Bearer ${device.token}` },
      payload,
    );
    assert.equal(response.status, 200);
    assert.equal(response.json.data.stored, 1);
  } finally {
    await app.close();
  }
});

test("largeBodyReturns413AndConsumesLimiterToken", async () => {
  const device = await createTestDevice();
  const before = await rateTokens(device.deviceId);
  const app = httpApi();
  try {
    const payload =
      JSON.stringify({ readings: [reading({ reading_id: "too-large" })] }) +
      " ".repeat(140 * 1024);
    const response = await app.request(
      "/api/iot/v1/readings",
      "POST",
      undefined,
      { authorization: `Bearer ${device.token}` },
      payload,
    );
    assert.equal(response.status, 413);
    assert.equal(response.json.error.code, "PAYLOAD_TOO_LARGE");
    assert.ok(response.json.error.requestId);
    assert.ok((await rateTokens(device.deviceId)) < before);
  } finally {
    await app.close();
  }
});

test("rateLimitReturnsRetryAfter", async () => {
  const device = await createTestDevice();
  await registrySql.query(
    "UPDATE farm_device SET rate_limit_tokens=0,rate_refilled_at=clock_timestamp() WHERE id=$1",
    [device.deviceId],
  );
  const app = httpApi();
  try {
    const response = await app.request(
      "/api/iot/v1/readings",
      "POST",
      { readings: [reading({ reading_id: "rate-limited" })] },
      { authorization: `Bearer ${device.token}` },
    );
    assert.equal(response.status, 429);
    assert.equal(response.json.error.code, "RATE_LIMITED");
    assert.match(response.retryAfter ?? "", /^\d+$/);
  } finally {
    await app.close();
  }
});

test("retentionSweepUsesOnlyDatabaseFunction", async () => {
  const statements: string[] = [];
  const db: Database = {
    transaction: async (work) =>
      work({
        async query<
          T extends Record<string, unknown> = Record<string, unknown>,
        >(text: string, _params?: unknown[]) {
          statements.push(text);
          return { rows: [{ deleted: 3 } as unknown as T] };
        },
      }),
  };

  assert.equal(await runTelemetryRetentionTick(db, 50), 3);
  assert.deepEqual(statements, [
    "SELECT purge_expired_telemetry($1) AS deleted",
  ]);
});

test("retentionSweepIsBounded", async () => {
  let queryCount = 0;
  const db: Database = {
    transaction: async (work) =>
      work({
        async query<
          T extends Record<string, unknown> = Record<string, unknown>,
        >(_text: string, _params?: unknown[]) {
          queryCount += 1;
          return { rows: [{ deleted: 0 } as unknown as T] };
        },
      }),
  };

  await assert.rejects(runTelemetryRetentionTick(db, 0), RangeError);
  await assert.rejects(runTelemetryRetentionTick(db, 1001), RangeError);
  assert.equal(queryCount, 0);
});

test("retentionWorkerStopsCleanly", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let queryCount = 0;
  let tickFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    tickFinished = resolve;
  });
  const db: Database = {
    transaction: async (work) =>
      work({
        async query<
          T extends Record<string, unknown> = Record<string, unknown>,
        >(_text: string, _params?: unknown[]) {
          queryCount += 1;
          tickFinished();
          return { rows: [{ deleted: 0 } as unknown as T] };
        },
      }),
  };

  const stop = startTelemetryRetentionWorker(db);
  await finished;
  await new Promise<void>((resolve) => setImmediate(resolve));
  stop();
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  assert.equal(queryCount, 1);
});

test("retentionWorkerRetriesFullBatchAfterMinute", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let queryCount = 0;
  let tickFinished!: () => void;
  const firstFinished = new Promise<void>((resolve) => {
    tickFinished = resolve;
  });
  const db: Database = {
    transaction: async (work) =>
      work({
        async query<
          T extends Record<string, unknown> = Record<string, unknown>,
        >(_text: string, _params?: unknown[]) {
          queryCount += 1;
          if (queryCount === 1) tickFinished();
          return { rows: [{ deleted: 1000 } as unknown as T] };
        },
      }),
  };

  const stop = startTelemetryRetentionWorker(db);
  await firstFinished;
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(59_999);
  assert.equal(queryCount, 1);
  t.mock.timers.tick(1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(queryCount, 2);
  stop();
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  assert.equal(queryCount, 2);
});

test("P3-02 migration enforces versioned alert config and one open episode", async () => {
  const result = await registrySql.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM pg_class
     WHERE relkind='r' AND relname=ANY($1::text[])`,
    [
      [
        "farm_device_alert_config",
        "farm_device_alert_episode",
        "farm_device_alert_transition",
      ],
    ],
  );
  assert.equal(result.rows[0]?.count, "3");

  const device = await createTestDevice();
  const config = await registrySql.query<{ version: number }>(
    `INSERT INTO farm_device_alert_config
       (device_id,metric_key,measurement_unit,version,low_threshold,
        high_threshold,stale_after_seconds,changed_by)
     VALUES($1,'water_temperature','degC',1,18,30,60,$2)
     RETURNING version`,
    [device.deviceId, registryFarm.actorId],
  );
  assert.equal(config.rows[0]?.version, 1);

  await assert.rejects(() =>
    registrySql.query(
      `INSERT INTO farm_device_alert_config
         (device_id,metric_key,measurement_unit,version,low_threshold,
          high_threshold,stale_after_seconds,changed_by)
       VALUES($1,'water_temperature','degC',2,30,18,59,$2)`,
      [device.deviceId, registryFarm.actorId],
    ),
  );

  const episodeId = randomUUID();
  const episodeValues = [
    episodeId,
    registryFarm.farmId,
    device.deviceId,
    registryFarm.actorId,
  ];
  const insertEpisode = `INSERT INTO farm_device_alert_episode
    (id,farm_id,device_id,metric_key,measurement_unit,condition_kind,
     config_version,open_reason,opened_by)
   VALUES($1,$2,$3,'water_temperature','degC','LOW',1,'THRESHOLD',$4)`;
  await registrySql.query(insertEpisode, episodeValues);
  await assert.rejects(() =>
    registrySql.query(insertEpisode, [randomUUID(), ...episodeValues.slice(1)]),
  );

  await registrySql.query(
    `INSERT INTO notification_outbox
       (id,farm_id,event_key,event_type,source_id,payload)
     VALUES($1,$2,$3,'IOT_ALERT',$4,'{}'::jsonb)`,
    [randomUUID(), registryFarm.farmId, `iot:${episodeId}`, episodeId],
  );

  const expiredEpisodeId = randomUUID();
  const expiredAt = new Date(
    Date.now() - 91 * 24 * 60 * 60 * 1000,
  ).toISOString();
  await registrySql.query(
    `INSERT INTO farm_device_alert_episode
       (id,farm_id,device_id,metric_key,measurement_unit,condition_kind,
        config_version,opened_at,resolved_at,open_reason,resolved_reason)
     VALUES($1,$2,$3,'water_temperature','degC','HIGH',1,$4,$4,
       'THRESHOLD','RECOVERED')`,
    [expiredEpisodeId, registryFarm.farmId, device.deviceId, expiredAt],
  );
  await registrySql.query(
    `INSERT INTO farm_device_alert_transition
       (id,farm_id,episode_id,transition_type,occurred_at,reason,config_version)
     VALUES($1,$2,$3,'OPENED',$4,'THRESHOLD',1),
       ($5,$2,$3,'RECOVERED',$4,'RECOVERED',1)`,
    [
      randomUUID(),
      registryFarm.farmId,
      expiredEpisodeId,
      expiredAt,
      randomUUID(),
    ],
  );
  const purge = await registrySql.query<{ deleted: string }>(
    "SELECT purge_expired_iot_alert_history(1000)::text AS deleted",
  );
  assert.equal(purge.rows[0]?.deleted, "1");
  const preserved = await registrySql.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM farm_device_alert_episode WHERE id=$1",
    [episodeId],
  );
  assert.equal(preserved.rows[0]?.count, "1");
});

test("P3-02 config is versioned, idempotent, and reevaluates latest GOOD reading", async () => {
  const device = await createTestDevice();
  await ingestReadings(registryDb, device.token!, {
    readings: [reading({ reading_id: "before-config", value: "17" })],
  });
  const context = registryContext();
  const key = randomUUID();
  const input = {
    unit: "degC",
    low: "18",
    high: "30",
    staleAfterSeconds: null,
  };

  await assert.rejects(
    setDeviceMetricAlertConfig(
      registryDb,
      context,
      device.deviceId,
      "water_temperature",
      randomUUID(),
      { ...input, unit: "ppm" },
    ),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "VALIDATION",
  );

  const first = await setDeviceMetricAlertConfig(
    registryDb,
    context,
    device.deviceId,
    "water_temperature",
    key,
    input,
  );
  const replay = await setDeviceMetricAlertConfig(
    registryDb,
    context,
    device.deviceId,
    "water_temperature",
    key,
    input,
  );
  assert.deepEqual(replay, first);
  assert.equal(first.version, 1);

  const state = await registrySql.query<{ episodes: string; events: string }>(
    `SELECT
       (SELECT count(*)::text FROM farm_device_alert_episode WHERE device_id=$1) AS episodes,
       (SELECT count(*)::text FROM notification_outbox WHERE source_id IN
         (SELECT id FROM farm_device_alert_episode WHERE device_id=$1)
         AND event_type='IOT_ALERT') AS events`,
    [device.deviceId],
  );
  assert.equal(state.rows[0]?.episodes, "1");
  assert.equal(state.rows[0]?.events, "1");

  const memberId = randomUUID();
  await registrySql.query(
    "INSERT INTO app_user(id,auth_subject,display_name) VALUES($1,$2,'ALERT MEMBER TEST')",
    [memberId, `test:${memberId}`],
  );
  await registrySql.query(
    "INSERT INTO farm_membership(farm_id,user_id,added_by) VALUES($1,$2,$3)",
    [registryFarm.farmId, memberId, registryFarm.actorId],
  );
  const memberConfig = await setDeviceMetricAlertConfig(
    registryDb,
    registryContext(registryFarm.farmId, memberId),
    device.deviceId,
    "water_temperature",
    randomUUID(),
    input,
  );
  assert.equal(memberConfig.version, 2);
  assert.equal(memberConfig.changedBy, memberId);
  const versions = await registrySql.query<{
    count: string;
    open_count: string;
  }>(
    `SELECT count(*)::text AS count,
       count(*) FILTER (WHERE resolved_at IS NULL)::text AS open_count
     FROM farm_device_alert_episode WHERE device_id=$1`,
    [device.deviceId],
  );
  assert.deepEqual(versions.rows[0], { count: "2", open_count: "1" });

  await assert.rejects(
    setDeviceMetricAlertConfig(
      registryDb,
      context,
      device.deviceId,
      "water_temperature",
      key,
      { ...input, low: "19" },
    ),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "CONFLICT",
  );
  await assert.rejects(
    setDeviceMetricAlertConfig(
      registryDb,
      registryContext(randomUUID(), registryFarm.actorId),
      device.deviceId,
      "water_temperature",
      randomUUID(),
      input,
    ),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "FORBIDDEN",
  );
});

test("P3-02 ingest opens once, ignores duplicate/non-GOOD, and resolves at threshold", async () => {
  const device = await createTestDevice();
  await setDeviceMetricAlertConfig(
    registryDb,
    registryContext(),
    device.deviceId,
    "water_temperature",
    randomUUID(),
    { unit: "degC", low: "18", high: "30", staleAfterSeconds: null },
  );

  const base = Date.now();
  const breached = reading({
    reading_id: "below-threshold",
    value: "17",
    observed_at: new Date(base - 10_000).toISOString(),
  });
  await ingestReadings(registryDb, device.token!, { readings: [breached] });
  await ingestReadings(registryDb, device.token!, { readings: [breached] });
  await ingestReadings(registryDb, device.token!, {
    readings: [
      reading({
        reading_id: "late-inside-threshold",
        value: "25",
        observed_at: new Date(base - 20_000).toISOString(),
      }),
    ],
  });
  await ingestReadings(registryDb, device.token!, {
    readings: [
      reading({
        reading_id: "suspect-at-bound",
        value: "18",
        quality: "SUSPECT",
        observed_at: new Date(base - 5_000).toISOString(),
      }),
      reading({
        reading_id: "invalid-at-bound",
        value: "18",
        quality: "INVALID",
        observed_at: new Date(base - 4_000).toISOString(),
      }),
    ],
  });
  const state = await registrySql.query<{
    opened: string;
    open: string;
    events: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM farm_device_alert_episode WHERE device_id=$1) AS opened,
       (SELECT count(*)::text FROM farm_device_alert_episode WHERE device_id=$1 AND resolved_at IS NULL) AS open,
       (SELECT count(*)::text FROM notification_outbox WHERE event_type='IOT_ALERT' AND source_id IN
         (SELECT id FROM farm_device_alert_episode WHERE device_id=$1)) AS events`,
    [device.deviceId],
  );
  assert.deepEqual(state.rows[0], { opened: "1", open: "1", events: "1" });

  await ingestReadings(registryDb, device.token!, {
    readings: [
      reading({
        reading_id: "at-threshold",
        value: "18",
        observed_at: new Date(base - 1_000).toISOString(),
      }),
    ],
  });
  const recoveredState = await registrySql.query<{
    opened: string;
    open: string;
    resolved: string;
  }>(
    `SELECT
       count(*)::text AS opened,
       count(*) FILTER (WHERE resolved_at IS NULL)::text AS open,
       count(*) FILTER (WHERE resolved_reason='RECOVERED')::text AS resolved
     FROM farm_device_alert_episode WHERE device_id=$1`,
    [device.deviceId],
  );
  assert.deepEqual(recoveredState.rows[0], {
    opened: "1",
    open: "0",
    resolved: "1",
  });
});

test("P3-02 history APIs include every quality, page stably, and scope to membership", async () => {
  const device = await createTestDevice();
  const now = Date.now();
  await setDeviceMetricAlertConfig(
    registryDb,
    registryContext(),
    device.deviceId,
    "water_temperature",
    randomUUID(),
    { unit: "degC", low: "18", high: "30", staleAfterSeconds: null },
  );
  await ingestReadings(registryDb, device.token!, {
    readings: [
      reading({
        reading_id: "history-old",
        value: "17",
        observed_at: new Date(now - 3_000).toISOString(),
      }),
    ],
  });
  await ingestReadings(registryDb, device.token!, {
    readings: [
      reading({
        reading_id: "history-invalid",
        value: "0",
        quality: "INVALID",
        observed_at: new Date(now - 2_000).toISOString(),
      }),
      reading({
        reading_id: "history-current",
        value: "18",
        observed_at: new Date(now - 1_000).toISOString(),
      }),
    ],
  });
  const app = httpApi();
  try {
    const first = await app.request(
      `/api/farms/${registryFarm.farmId}/devices/${device.deviceId}/readings?metric=water_temperature&unit=degC&limit=2`,
    );
    assert.equal(first.status, 200);
    assert.deepEqual(
      first.json.data.items.map(
        (item: { readingId: string }) => item.readingId,
      ),
      ["history-current", "history-invalid"],
    );
    assert.equal(first.json.data.items[1].quality, "INVALID");
    const cursor = first.json.data.nextCursor;
    assert.equal(typeof cursor, "string");
    const second = await app.request(
      `/api/farms/${registryFarm.farmId}/devices/${device.deviceId}/readings?metric=water_temperature&unit=degC&limit=2&cursor=${encodeURIComponent(cursor)}`,
    );
    assert.deepEqual(
      second.json.data.items.map(
        (item: { readingId: string }) => item.readingId,
      ),
      ["history-old"],
    );
    assert.equal(second.json.data.nextCursor, null);

    const alerts = await app.request(
      `/api/farms/${registryFarm.farmId}/devices/${device.deviceId}/alerts?limit=5`,
    );
    assert.equal(alerts.status, 200);
    assert.equal(alerts.json.data.configs[0].version, 1);
    assert.equal(alerts.json.data.items[0].condition, "LOW");
    assert.equal(alerts.json.data.items[0].resolvedReason, "RECOVERED");
    assert.equal(alerts.json.data.items[0].transitions.length, 2);

    const foreignFarm = await fixture(registrySql);
    const foreign = await app.request(
      `/api/farms/${foreignFarm.farmId}/devices/${device.deviceId}/alerts`,
    );
    assert.equal(foreign.status, 403);
    assert.equal(foreign.json.error.code, "FORBIDDEN");
  } finally {
    await app.close();
  }
});

test("P3-02 disabling a metric and revoking a device close open episodes", async () => {
  const context = registryContext();
  const disabledDevice = await createTestDevice();
  await setDeviceMetricAlertConfig(
    registryDb,
    context,
    disabledDevice.deviceId,
    "water_temperature",
    randomUUID(),
    { unit: "degC", low: "18", high: null, staleAfterSeconds: null },
  );
  await ingestReadings(registryDb, disabledDevice.token!, {
    readings: [reading({ reading_id: "disabled-source", value: "17" })],
  });
  await setDeviceMetrics(
    registryDb,
    context,
    disabledDevice.deviceId,
    randomUUID(),
    {
      metrics: [{ metric: "water_temperature", unit: "degC", active: false }],
    },
  );
  const disabled = await registrySql.query<{ resolved_reason: string | null }>(
    "SELECT resolved_reason FROM farm_device_alert_episode WHERE device_id=$1",
    [disabledDevice.deviceId],
  );
  assert.deepEqual(disabled.rows, [{ resolved_reason: "METRIC_DISABLED" }]);

  const revokedDevice = await createTestDevice();
  await setDeviceMetricAlertConfig(
    registryDb,
    context,
    revokedDevice.deviceId,
    "water_temperature",
    randomUUID(),
    { unit: "degC", low: "18", high: null, staleAfterSeconds: null },
  );
  await ingestReadings(registryDb, revokedDevice.token!, {
    readings: [reading({ reading_id: "revoked-source", value: "17" })],
  });
  await revokeDevice(registryDb, context, revokedDevice.deviceId, randomUUID());
  const revoked = await registrySql.query<{ resolved_reason: string | null }>(
    "SELECT resolved_reason FROM farm_device_alert_episode WHERE device_id=$1",
    [revokedDevice.deviceId],
  );
  assert.deepEqual(revoked.rows, [{ resolved_reason: "DEVICE_REVOKED" }]);
});

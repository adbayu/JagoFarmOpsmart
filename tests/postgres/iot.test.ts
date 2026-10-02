import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import type { RequestHandler } from "express";
import pg from "pg";
import type { CommandContext } from "../../src/shared/domain.js";
import { DomainError, RateLimitedError } from "../../src/shared/errors.js";
import {
  authenticateAndConsumeRateLimit,
  ingestReadings,
} from "../../src/modules/iot/ingest.js";
import {
  createDevice,
  revokeDevice,
  rotateDeviceToken,
} from "../../src/modules/iot/service.js";
import { postgresDatabase } from "../../src/server/db.js";

type FarmFixture = CommandContext & { unitId: string };

async function createFarm(pool: pg.Pool, name: string): Promise<FarmFixture> {
  const actorId = randomUUID();
  const farmId = randomUUID();
  const unitId = randomUUID();
  await pool.query(
    "INSERT INTO app_user(id,auth_subject,display_name) VALUES($1,$2,$3)",
    [actorId, `test:${actorId}`, "P3-01 TEST USER"],
  );
  await pool.query("INSERT INTO farm(id,owner_id,name) VALUES($1,$2,$3)", [
    farmId,
    actorId,
    name,
  ]);
  await pool.query(
    "INSERT INTO farm_membership(farm_id,user_id,added_by) VALUES($1,$2,$2)",
    [farmId, actorId],
  );
  await pool.query(
    "INSERT INTO farm_unit(id,farm_id,name,farming_type) VALUES($1,$2,$3,'FISH')",
    [unitId, farmId, "Unit IoT TEST"],
  );
  return { actorId, farmId, unitId };
}

async function createTestDevice(
  db: ReturnType<typeof postgresDatabase>,
  farm: FarmFixture,
  metric = "water_temperature",
) {
  return createDevice(db, farm, randomUUID(), {
    name: "Sensor IoT TEST",
    farmUnitId: farm.unitId,
    metrics: [{ metric, unit: metric === "humidity" ? "percent" : "degC" }],
  });
}

function authorize(middleware: RequestHandler, token: string) {
  return new Promise<unknown | null>((resolve) => {
    void middleware(
      { get: () => `Bearer ${token}` } as never,
      { locals: {} } as never,
      (error) => resolve(error ?? null),
    );
  });
}

function reading(readingId: string) {
  return {
    readings: [
      {
        reading_id: readingId,
        metric: "water_temperature",
        unit: "degC",
        value: "24.125",
        observed_at: new Date(Date.now() - 60_000).toISOString(),
      },
    ],
  };
}

test(
  "P3-01 PostgreSQL concurrency, tenancy, retention, and function permissions",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const url = process.env.TEST_DATABASE_URL!;
    if (!new URL(url).pathname.toLowerCase().includes("test"))
      throw new Error("Use a dedicated database whose name contains test");

    const schema = `opsmart_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({ connectionString: url });
    const poolOptions = {
      connectionString: url,
      max: 4,
      options: `-c search_path=${schema}`,
    };
    const pool = new pg.Pool(poolOptions);
    const secondPool = new pg.Pool(poolOptions);
    const db = postgresDatabase(pool);

    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      for (const name of (await readdir("db/migrations"))
        .filter((file) => file.endsWith(".sql"))
        .sort())
        await pool.query(await readFile(`db/migrations/${name}`, "utf8"));

      await t.test("twoConnectionsShareDeviceBucket", async () => {
        const farm = await createFarm(pool, "Rate limit TEST");
        const device = await createTestDevice(db, farm);
        await pool.query(
          `UPDATE farm_device
           SET rate_limit_tokens=1,
               rate_refilled_at=clock_timestamp()+interval '1 hour'
           WHERE id=$1`,
          [device.deviceId],
        );
        const first = authenticateAndConsumeRateLimit(db);
        const second = authenticateAndConsumeRateLimit(
          postgresDatabase(secondPool),
        );
        const results = await Promise.all([
          authorize(first, device.token!),
          authorize(second, device.token!),
        ]);
        assert.equal(results.filter((result) => result === null).length, 1);
        assert.equal(
          results.filter((result) => result instanceof RateLimitedError).length,
          1,
        );
      });

      await t.test(
        "concurrentIngestAndRevokeHasOneSerializedOutcome",
        async () => {
          const farm = await createFarm(pool, "Concurrent revoke TEST");
          const device = await createTestDevice(db, farm);
          const [ingest, revoke] = await Promise.allSettled([
            ingestReadings(db, device.token!, reading("concurrent-reading")),
            revokeDevice(db, farm, device.deviceId, randomUUID()),
          ]);
          assert.equal(revoke.status, "fulfilled");
          if (ingest.status === "rejected")
            assert.ok(
              ingest.reason instanceof DomainError &&
                ingest.reason.code === "UNAUTHORIZED",
            );
          else assert.equal(ingest.value.stored, 1);

          const state = await pool.query<{
            status: string;
            readings: string;
          }>(
            `SELECT device.status::text AS status,
                  count(reading.id)::text AS readings
           FROM farm_device AS device
           LEFT JOIN telemetry_reading AS reading ON reading.device_id=device.id
           WHERE device.id=$1
           GROUP BY device.id`,
            [device.deviceId],
          );
          assert.equal(state.rows[0]?.status, "REVOKED");
          assert.equal(
            state.rows[0]?.readings,
            ingest.status === "fulfilled" ? "1" : "0",
          );
        },
      );

      await t.test("oldTokenFailsAfterRotationCommit", async () => {
        const farm = await createFarm(pool, "Rotation TEST");
        const device = await createTestDevice(db, farm);
        const rotated = await rotateDeviceToken(
          db,
          farm,
          device.deviceId,
          randomUUID(),
        );
        assert.ok(rotated.token);
        assert.notEqual(rotated.token, device.token);
        await assert.rejects(
          ingestReadings(db, device.token!, reading("old-token-reading")),
          (error: unknown) =>
            error instanceof DomainError && error.code === "UNAUTHORIZED",
        );
        assert.equal(
          (
            await ingestReadings(
              db,
              rotated.token!,
              reading("new-token-reading"),
            )
          ).stored,
          1,
        );
      });

      await t.test("foreignDeviceMetricCannotCrossFarm", async () => {
        const firstFarm = await createFarm(pool, "First farm TEST");
        const secondFarm = await createFarm(pool, "Second farm TEST");
        const firstDevice = await createTestDevice(db, firstFarm);
        const secondDevice = await createTestDevice(db, secondFarm, "humidity");
        await assert.rejects(
          pool.query(
            `INSERT INTO telemetry_reading
               (id,device_id,farm_id,farm_unit_id,reading_id,metric_key,
                measurement_unit,value,observed_at)
             VALUES($1,$2,$3,$4,$5,'humidity','percent',50,clock_timestamp())`,
            [
              randomUUID(),
              firstDevice.deviceId,
              firstFarm.farmId,
              firstFarm.unitId,
              `foreign-${secondDevice.deviceId}`,
            ],
          ),
          (error: unknown) =>
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "23503",
        );
      });

      await t.test("purgeFunctionAclAndSearchPath", async () => {
        const result = await pool.query<{
          securityDefiner: boolean;
          settings: string[] | null;
          publicExecute: boolean;
        }>(
          `SELECT procedure.prosecdef AS "securityDefiner",
                  procedure.proconfig AS settings,
                  EXISTS (
                    SELECT 1
                    FROM pg_catalog.aclexplode(
                      coalesce(
                        procedure.proacl,
                        pg_catalog.acldefault('f', procedure.proowner)
                      )
                    ) AS permission
                    WHERE permission.grantee=0
                      AND permission.privilege_type='EXECUTE'
                  ) AS "publicExecute"
           FROM pg_catalog.pg_proc AS procedure
           JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid=procedure.pronamespace
           WHERE namespace.nspname=$1
             AND procedure.proname='purge_expired_telemetry'`,
          [schema],
        );
        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0]?.securityDefiner, true);
        assert.ok(
          result.rows[0]?.settings?.includes("search_path=pg_catalog, public"),
        );
        assert.equal(result.rows[0]?.publicExecute, false);
      });

      await t.test("purgeFunctionDeletesAtMostBatch", async () => {
        const farm = await createFarm(pool, "Retention TEST");
        const device = await createTestDevice(db, farm);
        for (let index = 0; index < 3; index += 1)
          await pool.query(
            `INSERT INTO telemetry_reading
               (id,device_id,farm_id,farm_unit_id,reading_id,metric_key,
                measurement_unit,value,observed_at,received_at)
             VALUES($1,$2,$3,$4,$5,'water_temperature','degC',24,
                    clock_timestamp(),clock_timestamp()-interval '91 days')`,
            [
              randomUUID(),
              device.deviceId,
              farm.farmId,
              farm.unitId,
              `expired-${index}`,
            ],
          );
        await pool.query(
          `INSERT INTO telemetry_reading
             (id,device_id,farm_id,farm_unit_id,reading_id,metric_key,
              measurement_unit,value,observed_at)
           VALUES($1,$2,$3,$4,'recent-reading','water_temperature','degC',24,
                  clock_timestamp())`,
          [randomUUID(), device.deviceId, farm.farmId, farm.unitId],
        );
        await admin.query(
          `ALTER FUNCTION ${schema}.purge_expired_telemetry(integer)
           SET search_path TO pg_catalog, ${schema}, public`,
        );
        const first = await pool.query<{ deleted: string }>(
          "SELECT purge_expired_telemetry(2)::text AS deleted",
        );
        assert.equal(first.rows[0]?.deleted, "2");
        const second = await pool.query<{ deleted: string }>(
          "SELECT purge_expired_telemetry(2)::text AS deleted",
        );
        assert.equal(second.rows[0]?.deleted, "1");
        const counts = await pool.query<{ expired: string; total: string }>(
          `SELECT count(*) FILTER (
                    WHERE received_at < clock_timestamp()-interval '90 days'
                  )::text AS expired,
                  count(*)::text AS total
           FROM telemetry_reading WHERE device_id=$1`,
          [device.deviceId],
        );
        assert.deepEqual(counts.rows[0], { expired: "0", total: "1" });
      });
    } finally {
      await Promise.all([pool.end(), secondPool.end()]);
      if (!/^opsmart_test_[a-f0-9]{32}$/.test(schema))
        throw new Error("Invalid test schema");
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  },
);

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import { createApp } from "../src/server/app.js";
import { PGlite } from "@electric-sql/pglite";
import type { Database, Sql } from "../src/server/db.js";
import {
  adjustStock,
  stockIn,
  transferStock,
} from "../src/modules/inventory/movement-service.js";
import { processNotificationWorkerTick } from "../src/modules/notifications/worker.js";
import { setDeviceMetricAlertConfig } from "../src/modules/iot/alerts.js";
import { createDevice } from "../src/modules/iot/service.js";
import { ingestReadings } from "../src/modules/iot/ingest.js";
import { fixture } from "./fixture.js";

let sql: PGlite;
let db: Database;

before(async () => {
  sql = new PGlite();
  for (const name of (await readdir("db/migrations"))
    .filter((item) => item.endsWith(".sql"))
    .sort())
    await sql.exec(await readFile(`db/migrations/${name}`, "utf8"));
  db = { transaction: (work) => sql.transaction((tx) => work(tx)) };
});

after(async () => {
  await sql.close();
});

const key = () => randomUUID();
const fixedNow = new Date("2026-09-30T00:00:00Z");

async function apiFor(userId: string) {
  const server = createApp(db, async () => ({ userId })).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  return {
    request: async (path: string, method = "GET", body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: response.status,
        json: (await response.json()) as Record<string, unknown>,
      };
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

test("worker deduplicates the 24-hour reminder and delivers it to each active member", async () => {
  const f = await fixture(sql);
  const memberId = randomUUID();
  await sql.query(
    "INSERT INTO app_user(id,auth_subject,display_name) VALUES($1,$2,$3)",
    [memberId, `test:${memberId}`, "SECOND MEMBER"],
  );
  await sql.query(
    "INSERT INTO farm_membership(farm_id,user_id,added_by) VALUES($1,$2,$3)",
    [f.farmId, memberId, f.actorId],
  );
  await sql.query(
    "UPDATE activity SET scheduled_at=$2,status='SCHEDULED' WHERE farm_id=$1 AND id=$3",
    [f.farmId, "2026-10-01T00:00:00Z", f.activityId],
  );

  await processNotificationWorkerTick(db, fixedNow);
  await processNotificationWorkerTick(
    db,
    new Date(fixedNow.getTime() + 60_000),
  );

  const events = await sql.query<{ event_type: string }>(
    "SELECT event_type FROM notification_outbox WHERE farm_id=$1",
    [f.farmId],
  );
  const inbox = await sql.query<{
    recipient_id: string;
    read_at: string | null;
  }>(
    "SELECT recipient_id,read_at FROM farm_notification WHERE farm_id=$1 ORDER BY recipient_id",
    [f.farmId],
  );
  assert.deepEqual(
    events.rows.map((row) => row.event_type),
    ["SCHEDULE_REMINDER"],
  );
  assert.deepEqual(
    inbox.rows.map((row) => row.recipient_id),
    [f.actorId, memberId].sort(),
  );
  assert.ok(inbox.rows.every((row) => row.read_at === null));
});

test("P3-02 stale alert opens at timeout once and only a fresh GOOD reading recovers it", async () => {
  const f = await fixture(sql);
  const device = await createDevice(
    db,
    { farmId: f.farmId, actorId: f.actorId },
    key(),
    {
      name: "Sensor stale test",
      farmUnitId: f.unitId,
      metrics: [{ metric: "water_temperature", unit: "degC" }],
    },
  );
  const config = await setDeviceMetricAlertConfig(
    db,
    { farmId: f.farmId, actorId: f.actorId },
    device.deviceId,
    "water_temperature",
    key(),
    { unit: "degC", low: null, high: null, staleAfterSeconds: 60 },
  );
  const unmonitoredDevice = await createDevice(
    db,
    { farmId: f.farmId, actorId: f.actorId },
    key(),
    {
      name: "Sensor tanpa timeout",
      farmUnitId: f.unitId,
      metrics: [{ metric: "humidity", unit: "percent" }],
    },
  );
  await setDeviceMetricAlertConfig(
    db,
    { farmId: f.farmId, actorId: f.actorId },
    unmonitoredDevice.deviceId,
    "humidity",
    key(),
    { unit: "percent", low: null, high: null, staleAfterSeconds: null },
  );
  const activatedAt = new Date(config.changedAt);
  const staleAt = new Date(activatedAt.getTime() + 60_000);
  await processNotificationWorkerTick(db, staleAt);
  await processNotificationWorkerTick(db, staleAt);

  let episode = await sql.query<{
    count: string;
    resolved_at: string | null;
  }>(
    `SELECT count(*)::text AS count,max(resolved_at)::text AS resolved_at
     FROM farm_device_alert_episode WHERE device_id=$1 AND condition_kind='STALE'`,
    [device.deviceId],
  );
  assert.equal(episode.rows[0]?.count, "1");
  assert.equal(episode.rows[0]?.resolved_at, null);
  const unmonitoredEpisode = await sql.query(
    `SELECT id FROM farm_device_alert_episode
     WHERE device_id=$1 AND condition_kind='STALE'`,
    [unmonitoredDevice.deviceId],
  );
  assert.equal(unmonitoredEpisode.rows.length, 0);

  const observedAt = new Date(activatedAt.getTime() + 40_000).toISOString();
  await ingestReadings(db, device.token!, {
    readings: [
      {
        reading_id: "suspect-freshness-only",
        metric: "water_temperature",
        unit: "degC",
        value: "22",
        observed_at: observedAt,
        quality: "SUSPECT",
      },
    ],
  });
  await processNotificationWorkerTick(
    db,
    new Date(activatedAt.getTime() + 90_000),
  );
  episode = await sql.query(
    `SELECT id FROM farm_device_alert_episode
     WHERE device_id=$1 AND condition_kind='STALE' AND resolved_at IS NULL`,
    [device.deviceId],
  );
  assert.equal(episode.rows.length, 1);

  await ingestReadings(db, device.token!, {
    readings: [
      {
        reading_id: "good-freshness-recovery",
        metric: "water_temperature",
        unit: "degC",
        value: "22",
        observed_at: observedAt,
        quality: "GOOD",
      },
    ],
  });
  const recoveredAt = new Date(activatedAt.getTime() + 90_000);
  await processNotificationWorkerTick(db, recoveredAt);
  const state = await sql.query<{
    resolved_reason: string | null;
    resolved_at: string | null;
    event_count: string;
    inbox_resolved_at: string | null;
  }>(
    `SELECT e.resolved_reason,e.resolved_at::text AS resolved_at,
       (SELECT count(*)::text FROM notification_outbox o
        WHERE o.event_type='IOT_ALERT' AND o.source_id=e.id) AS event_count,
       (SELECT max(n.resolved_at)::text FROM farm_notification n
        JOIN notification_outbox o ON o.id=n.outbox_id WHERE o.source_id=e.id) AS inbox_resolved_at
     FROM farm_device_alert_episode e
     WHERE e.device_id=$1 AND e.condition_kind='STALE'`,
    [device.deviceId],
  );
  assert.equal(state.rows[0]?.resolved_reason, "RECOVERED");
  assert.equal(state.rows[0]?.event_count, "1");
  assert.ok(state.rows[0]?.inbox_resolved_at);
});

test("stock alert episode uses aggregate lot balance and re-alerts after recovery", async () => {
  const f = await fixture(sql);
  await sql.query(
    "UPDATE activity SET status='COMPLETED' WHERE farm_id=$1 AND id=$2",
    [f.farmId, f.activityId],
  );
  const itemId = randomUUID();
  const lotA = randomUUID();
  const lotB = randomUUID();
  await sql.query(
    `INSERT INTO inventory_item(id,farm_id,name,category,unit,minimum_stock)
     VALUES($1,$2,'Pakan alert','FEED','KG',5)`,
    [itemId, f.farmId],
  );
  await sql.query(
    `INSERT INTO inventory_lot(id,farm_id,inventory_item_id,label)
     VALUES($1,$2,$3,'Lot A'),($4,$2,$3,'Lot B')`,
    [lotA, f.farmId, itemId, lotB],
  );
  const context = { farmId: f.farmId, actorId: f.actorId };

  await stockIn(db, context, {
    idempotencyKey: key(),
    lotId: lotA,
    quantity: "3",
    reason: "Stok awal",
  });
  await stockIn(db, context, {
    idempotencyKey: key(),
    lotId: lotB,
    quantity: "3",
    reason: "Pemulihan ambang",
  });
  await adjustStock(db, context, {
    idempotencyKey: key(),
    lotId: lotA,
    quantityDelta: "-1",
    reason: "Pemakaian pakan",
  });

  const events = await sql.query<{
    event_type: string;
    resolved_at: string | null;
  }>(
    `SELECT event_type,resolved_at FROM notification_outbox
     WHERE farm_id=$1 AND source_id=$2 ORDER BY event_key`,
    [f.farmId, itemId],
  );
  assert.equal(events.rows.length, 2);
  assert.ok(events.rows.every((row) => row.event_type === "LOW_STOCK"));
  assert.ok(events.rows[0]?.resolved_at);
  assert.equal(events.rows[1]?.resolved_at, null);

  await processNotificationWorkerTick(db, fixedNow);
  const inbox = await sql.query<{
    resolved_at: string | null;
    read_at: string | null;
  }>(
    `SELECT n.resolved_at,n.read_at FROM farm_notification n
     JOIN notification_outbox o ON o.id=n.outbox_id
     WHERE n.farm_id=$1 AND o.source_id=$2 ORDER BY o.event_key`,
    [f.farmId, itemId],
  );
  assert.equal(inbox.rows.length, 2);
  assert.ok(inbox.rows[0]?.resolved_at);
  assert.equal(inbox.rows[1]?.resolved_at, null);
  assert.ok(inbox.rows.every((row) => row.read_at === null));
});

test("same-item transfer checks the final aggregate balance, not its intermediate dip", async () => {
  const f = await fixture(sql);
  const itemId = randomUUID();
  const fromLotId = randomUUID();
  const toLotId = randomUUID();
  await sql.query(
    `INSERT INTO inventory_item(id,farm_id,name,category,unit,minimum_stock)
     VALUES($1,$2,'Transfer alert','FEED','KG',5)`,
    [itemId, f.farmId],
  );
  await sql.query(
    `INSERT INTO inventory_lot(id,farm_id,inventory_item_id,label)
     VALUES($1,$2,$3,'Lot A'),($4,$2,$3,'Lot B')`,
    [fromLotId, f.farmId, itemId, toLotId],
  );
  const context = { farmId: f.farmId, actorId: f.actorId };
  await stockIn(db, context, {
    idempotencyKey: key(),
    lotId: fromLotId,
    quantity: "10",
    reason: "Stok awal",
  });

  await transferStock(db, context, {
    idempotencyKey: key(),
    fromLotId,
    toLotId,
    quantity: "6",
    reason: "Pindah lot",
  });

  const events = await sql.query(
    "SELECT id FROM notification_outbox WHERE farm_id=$1 AND source_id=$2",
    [f.farmId, itemId],
  );
  const state = await sql.query<{ is_low: boolean }>(
    "SELECT is_low FROM inventory_notification_state WHERE farm_id=$1 AND inventory_item_id=$2",
    [f.farmId, itemId],
  );
  assert.equal(events.rows.length, 0);
  assert.equal(state.rows[0]?.is_low, false);
});

test("worker emits one overdue alert for unfinished activities but ignores completed ones", async () => {
  const f = await fixture(sql);
  const completedId = randomUUID();
  await sql.query(
    "UPDATE activity SET scheduled_at=$3,status='MISSED' WHERE farm_id=$1 AND id=$2",
    [f.farmId, f.activityId, "2026-09-29T23:00:00Z"],
  );
  await sql.query(
    `INSERT INTO activity(id,farm_id,cycle_id,kind,status,scheduled_at,created_by)
     VALUES($1,$2,$3,'FEEDING','COMPLETED','2026-09-29T22:00:00Z',$4)`,
    [completedId, f.farmId, f.cycleId, f.actorId],
  );

  await processNotificationWorkerTick(db, fixedNow);

  const events = await sql.query<{ event_type: string; source_id: string }>(
    "SELECT event_type,source_id FROM notification_outbox WHERE farm_id=$1",
    [f.farmId],
  );
  assert.deepEqual(events.rows, [
    { event_type: "SCHEDULE_OVERDUE", source_id: f.activityId },
  ]);
});

test("a failed fan-out records a safe error and retries the pending event", async () => {
  const f = await fixture(sql);
  await sql.query(
    "UPDATE activity SET status='COMPLETED' WHERE farm_id=$1 AND id=$2",
    [f.farmId, f.activityId],
  );
  const outboxId = randomUUID();
  await sql.query(
    `INSERT INTO notification_outbox(id,farm_id,event_key,event_type,source_id,payload)
     VALUES($1,$2,'test:retry','SCHEDULE_OVERDUE',$3,$4::jsonb)`,
    [
      outboxId,
      f.farmId,
      f.activityId,
      JSON.stringify({
        title: "Kegiatan terlewat",
        description: "Jadwal perlu diperiksa.",
        href: "/schedule",
        sourceLabel: "Pakan",
      }),
    ],
  );
  let failOnce = true;
  const flakyDb: Database = {
    transaction: <T>(work: (tx: Sql) => Promise<T>) =>
      db.transaction((tx) =>
        work({
          query<T extends Record<string, unknown> = Record<string, unknown>>(
            text: string,
            params?: unknown[],
          ) {
            if (failOnce && text.includes("INSERT INTO farm_notification")) {
              failOnce = false;
              throw new Error("sensitive database detail");
            }
            return tx.query<T>(text, params);
          },
        }),
      ),
  };

  await processNotificationWorkerTick(flakyDb, fixedNow);
  const failed = await sql.query<{
    attempt_count: number;
    delivered_at: string | null;
    last_error_code: string | null;
  }>(
    "SELECT attempt_count,delivered_at::text AS delivered_at,last_error_code FROM notification_outbox WHERE id=$1",
    [outboxId],
  );
  assert.equal(failed.rows[0]?.attempt_count, 1);
  assert.equal(failed.rows[0]?.delivered_at, null);
  assert.equal(failed.rows[0]?.last_error_code, "DELIVERY_FAILED");

  await processNotificationWorkerTick(
    flakyDb,
    new Date(fixedNow.getTime() + 60_000),
  );
  const retried = await sql.query<{
    attempt_count: number;
    delivered_at: string | null;
    last_error_code: string | null;
  }>(
    "SELECT attempt_count,delivered_at::text AS delivered_at,last_error_code FROM notification_outbox WHERE id=$1",
    [outboxId],
  );
  assert.equal(retried.rows[0]?.attempt_count, 2);
  assert.ok(retried.rows[0]?.delivered_at);
  assert.equal(retried.rows[0]?.last_error_code, null);
});

test("90-day cleanup removes inbox history but keeps the low-stock episode counter", async () => {
  const f = await fixture(sql);
  const oldOutboxId = randomUUID();
  const oldNotificationId = randomUUID();
  await sql.query(
    `INSERT INTO inventory_notification_state(farm_id,inventory_item_id,is_low,episode_count)
     VALUES($1,$2,true,7)`,
    [f.farmId, f.itemId],
  );
  await sql.query(
    `INSERT INTO notification_outbox
     (id,farm_id,event_key,event_type,source_id,payload,created_at,delivered_at)
     VALUES($1,$2,'stock:old:7','LOW_STOCK',$3,$4::jsonb,'2026-06-30T00:00:00Z','2026-06-30T00:01:00Z')`,
    [
      oldOutboxId,
      f.farmId,
      f.itemId,
      JSON.stringify({
        title: "Stok rendah",
        description: "",
        href: "/inventory",
        sourceLabel: "Pakan",
      }),
    ],
  );
  await sql.query(
    `INSERT INTO farm_notification(id,farm_id,outbox_id,recipient_id,created_at)
     VALUES($1,$2,$3,$4,'2026-06-30T00:01:00Z')`,
    [oldNotificationId, f.farmId, oldOutboxId, f.actorId],
  );

  await processNotificationWorkerTick(db, fixedNow);

  const retained = await sql.query<{ episode_count: string; is_low: boolean }>(
    `SELECT episode_count::text AS episode_count,is_low
     FROM inventory_notification_state WHERE farm_id=$1 AND inventory_item_id=$2`,
    [f.farmId, f.itemId],
  );
  const history = await sql.query(
    "SELECT id FROM farm_notification WHERE id=$1",
    [oldNotificationId],
  );
  const event = await sql.query(
    "SELECT id FROM notification_outbox WHERE id=$1",
    [oldOutboxId],
  );
  assert.deepEqual(retained.rows[0], { episode_count: "7", is_low: true });
  assert.equal(history.rows.length, 0);
  assert.equal(event.rows.length, 0);
});

test("inbox API scopes read state to each member and validates pagination", async () => {
  const f = await fixture(sql);
  const memberId = randomUUID();
  const outsiderId = randomUUID();
  await sql.query(
    "INSERT INTO app_user(id,auth_subject,display_name) VALUES($1,$2,$3),($4,$5,$6)",
    [
      memberId,
      `test:${memberId}`,
      "MEMBER",
      outsiderId,
      `test:${outsiderId}`,
      "OUTSIDER",
    ],
  );
  await sql.query(
    "INSERT INTO farm_membership(farm_id,user_id,added_by) VALUES($1,$2,$3)",
    [f.farmId, memberId, f.actorId],
  );
  const outboxId = randomUUID();
  const ownerNotificationId = randomUUID();
  const memberNotificationId = randomUUID();
  await sql.query(
    `INSERT INTO notification_outbox(id,farm_id,event_key,event_type,source_id,payload,delivered_at)
     VALUES($1,$2,$3,'LOW_STOCK',$4,$5::jsonb,now())`,
    [
      outboxId,
      f.farmId,
      `stock:${f.itemId}:1`,
      f.itemId,
      JSON.stringify({
        title: "Stok rendah",
        description: "Pakan mendekati batas minimum.",
        href: "/inventory",
        sourceLabel: "Pakan",
      }),
    ],
  );
  await sql.query(
    `INSERT INTO farm_notification(id,farm_id,outbox_id,recipient_id)
     VALUES($1,$2,$3,$4),($5,$2,$3,$6)`,
    [
      ownerNotificationId,
      f.farmId,
      outboxId,
      f.actorId,
      memberNotificationId,
      memberId,
    ],
  );

  const ownerApi = await apiFor(f.actorId);
  const memberApi = await apiFor(memberId);
  const outsiderApi = await apiFor(outsiderId);
  try {
    const ownerList = await ownerApi.request(
      `/api/farms/${f.farmId}/notifications?limit=10&offset=0`,
    );
    assert.equal(ownerList.status, 200);
    assert.equal(
      (ownerList.json.data as { unreadCount: number }).unreadCount,
      1,
    );
    assert.equal((ownerList.json.data as { items: unknown[] }).items.length, 1);
    assert.equal(
      (
        await ownerApi.request(
          `/api/farms/${f.farmId}/notifications?limit=101&offset=0`,
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await ownerApi.request(
          `/api/farms/${f.farmId}/notifications/${memberNotificationId}/read`,
          "POST",
        )
      ).status,
      404,
    );
    assert.equal(
      (await outsiderApi.request(`/api/farms/${f.farmId}/notifications`))
        .status,
      403,
    );

    const first = await ownerApi.request(
      `/api/farms/${f.farmId}/notifications/${ownerNotificationId}/read`,
      "POST",
    );
    const second = await ownerApi.request(
      `/api/farms/${f.farmId}/notifications/${ownerNotificationId}/read`,
      "POST",
    );
    assert.equal(first.status, 200);
    assert.equal(
      (first.json.data as { readAt: string }).readAt,
      (second.json.data as { readAt: string }).readAt,
    );
    const memberRead = await sql.query<{ read_at: string | null }>(
      "SELECT read_at::text AS read_at FROM farm_notification WHERE id=$1",
      [memberNotificationId],
    );
    assert.equal(memberRead.rows[0]?.read_at, null);
    assert.equal(
      (await memberApi.request(`/api/farms/${f.farmId}/notifications`)).status,
      200,
    );
  } finally {
    await Promise.all([
      ownerApi.close(),
      memberApi.close(),
      outsiderApi.close(),
    ]);
  }
});

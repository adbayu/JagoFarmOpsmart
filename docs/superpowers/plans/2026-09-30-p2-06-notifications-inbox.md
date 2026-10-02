# P2-06 In-App Notifications Implementation Plan

> **For agentic workers:** Implement this plan task-by-task in the current workspace, using the test-driven-development skill. The repository has no `.git` directory, so do not attempt commits.

**Goal:** Deliver a farm-scoped in-app inbox for schedule and low-stock alerts with retryable, deduplicated local outbox processing.

**Architecture:** Migration 012 stores pending outbox events, per-member inbox state, low-stock episodes, and worker heartbeat. Schedule events are scanned every 60 seconds; each inventory movement updates low-stock episode state and creates outbox events inside the source transaction. The worker fans pending events out to current active farm members. API routes enforce the session's farm membership, while the React route and dashboard preview reuse the existing OpSmart shell.

**Tech Stack:** Node.js 22, TypeScript, Express 5, PostgreSQL, PGlite, React 19, Vite, existing Zod contracts. Add no dependency.

**Spec:** `docs/superpowers/specs/2026-09-30-notifications-inbox-design.md`

## Global Constraints

- All active members have equal operating access; only the Owner can add members.
- In-app delivery only; do not send email, SMS, push, or external requests.
- Schedule reminder window is 24 hours; overdue means `SCHEDULED` or `MISSED` at/after due time.
- Stock alert threshold is movement-derived item balance `<= minimum_stock`, deduped until recovery.
- Inbox history retention is 90 days; polling interval is 60 seconds.
- Farm and actor scope comes from authenticated server identity and membership queries.
- Inventory movements and schedule state are read-only inputs to notification generation.

## Review Focus

- Multiple lots must be summed before checking `minimum_stock`; no per-lot duplicate alerts.
- Concurrent worker ticks must create and deliver one event per schedule key or stock episode.
- A worker outage across a due time must create one overdue event, not a stale 24-hour reminder.
- Read state is per recipient; another member's row remains unread.
- An alert from one farm must not appear in another farm's inbox or route response.

---

### Task 1: Durable event generation and outbox worker

**Files:**

- Create: `db/migrations/012_notifications_outbox.sql`
- Create: `src/modules/notifications/contracts.ts`
- Create: `src/modules/notifications/worker.ts`
- Create: `src/modules/notifications/stock-events.ts`
- Create: `tests/notifications.test.ts`
- Modify: `src/modules/inventory/movement-service.ts`
- Modify: `src/modules/inventory/ledger.ts`
- Modify: `src/modules/harvest/service.ts`
- Modify: `src/modules/sales/service.ts`
- Modify: `db/runtime-grants.sql`

**Interfaces:**

- Consumes: `Database.transaction`, `Sql.query`, `activity`, inventory ledger writes, `inventory_item`, `inventory_lot`, `inventory_movement`, and active `farm_membership` rows.
- Produces: `recordInventoryLevelTransitions(tx: Sql, farmId: string, itemIds: string[]): Promise<void>`, `processNotificationWorkerTick(db: Database, now?: Date): Promise<void>`, and `startNotificationWorker(db: Database): () => void`.

- [ ] **Step 1: Write a failing worker test**

```ts
test("worker creates a single reminder and fans it out to active members", async () => {
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
  const now = new Date("2026-09-30T00:00:00Z");
  await sql.query(
    "UPDATE activity SET scheduled_at=$2,status='SCHEDULED' WHERE id=$1",
    [f.activityId, "2026-10-01T00:00:00Z"],
  );

  await processNotificationWorkerTick(db, now);
  await processNotificationWorkerTick(db, new Date(now.getTime() + 60_000));
  const rows = await sql.query(
    "SELECT recipient_id FROM farm_notification ORDER BY recipient_id",
  );
  assert.equal(rows.rows.length, 2);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the worker/schema is missing**

Run: `npx tsx --test tests/notifications.test.ts`  
Expected: FAIL with the missing `notifications/worker.js` module.

- [ ] **Step 3: Implement migration and worker**

Create `notification_outbox` with unique `(farm_id,event_key)`, safe attempt/error fields, and a pending index; `farm_notification` with unique `(outbox_id,recipient_id)`, `read_at`, `resolved_at`, and a recipient/farm index; `inventory_notification_state` with one locked episode counter per farm/item; and singleton `notification_worker_state` with `last_success_at`. Add explicit runtime grants for the lifecycle columns and cleanup tables.

`recordInventoryLevelTransitions` must run once per distinct affected inventory item, after all movement rows in the source command are inserted and before commit. It sums movement deltas across all item lots, locks the farm/item episode row, emits one outbox event on healthy-to-low transition, and marks the episode resolved on recovery. Seed initial state for pre-existing items without duplicating state. `processNotificationWorkerTick` materializes due/overdue activity events; uses `FOR UPDATE SKIP LOCKED` for pending delivery; fans out to current active members; updates heartbeat; and prunes rows older than 90 days. Catch row failures, record a safe error code and retry on the next poll. `startNotificationWorker` runs one tick immediately, repeats every 60 seconds, prevents overlapping local ticks, and returns a stop function.

- [ ] **Step 4: Run worker tests**

Run: `npx tsx --test tests/notifications.test.ts`  
Expected: schedule boundaries, dedupe, stock threshold aggregation/recovery across repeated dips, fan-out, retry, and cleanup tests pass.

- [ ] **Step 5: Run the complete suite**

Run: `npm test`  
Expected: all tests pass; no migration parity or tenant-isolation regressions.

### Task 2: Farm-scoped inbox API

**Files:**

- Modify: `src/modules/notifications/contracts.ts`
- Create: `src/modules/notifications/queries.ts`
- Modify: `src/server/app.ts`
- Modify: `tests/notifications.test.ts`

**Interfaces:**

- Consumes: Task 1 notification tables and `processNotificationWorkerTick` results.
- Produces: `listNotifications(db, actorId, farmId, limit, offset)` and `markNotificationRead(db, actorId, farmId, notificationId)`.
- HTTP: `GET /api/farms/:farmId/notifications?limit=25&offset=0`; `POST /api/farms/:farmId/notifications/:notificationId/read`.

- [ ] **Step 1: Add failing route tests**

Test an authorized owner and member can read their own rows, a member cannot read another member's `read_at`, an unauthorized farm returns the existing safe forbidden status, invalid pagination is rejected, and repeated mark-read leaves the original timestamp unchanged.

- [ ] **Step 2: Run focused tests and observe the missing-route failure**

Run: `npx tsx --test tests/notifications.test.ts`  
Expected: FAIL because the notifications endpoints do not exist.

- [ ] **Step 3: Implement queries and routes**

Validate UUIDs and bounded pagination with Zod. Resolve actor with `requireActor`; use the existing membership boundary. Return `{ items, unreadCount, workerLastSuccessAt }`. Mark-read uses `COALESCE(read_at, now())` and only updates a row whose farm and recipient match the authenticated request.

- [ ] **Step 4: Re-run focused and full tests**

Run: `npx tsx --test tests/notifications.test.ts` then `npm test`  
Expected: focused route coverage and the full suite pass.

### Task 3: Inbox page and dashboard alert preview

**Files:**

- Create: `src/client/notifications.tsx`
- Modify: `src/client/routes.ts`
- Modify: `src/client/main.tsx`
- Modify: `src/client/dashboard.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**

- Consumes: Task 2 inbox payload, existing active-farm client state, dashboard primitives, and `Icon`.
- Produces: `/notifications` page and dashboard preview linking to it.

- [ ] **Step 1: Add page and preview using existing shell patterns**

Show event kind, source label, time, read/resolved state, source link, unread count, and mark-read. Provide loading, empty, stale-worker, error/retry, and mobile/keyboard states. Replace the dashboard “Belum tersedia” placeholder with up to four recent inbox rows and a link to `/notifications`.

- [ ] **Step 2: Run static validation**

Run: `npm run build`  
Expected: TypeScript and Vite build pass without a new dependency.

- [ ] **Step 3: Inspect the local preview**

Open `/notifications` and `/dashboard` in the existing preview. Confirm empty/unread/read/error states, mark-read behavior, farm switching, source links, responsive navigation, and stale worker label.

### Task 4: Worker lifecycle, docs, and release evidence

**Files:**

- Modify: `src/server/main.ts`
- Modify: `src/server/local-preview-main.ts`
- Modify: `src/server/local-preview.ts`
- Modify: `docs/implementation-roadmap.md`
- Modify: `docs/architecture.md`
- Modify: `docs/feature-status.md`
- Modify: `docs/verification.md`

**Interfaces:**

- Consumes: `startNotificationWorker(db)` from Task 1.
- Produces: worker startup after DB initialization and graceful stop on server shutdown.

- [ ] **Step 1: Add worker lifecycle tests or a focused smoke check**

Verify a tick runs immediately, interval ticks do not overlap, and the stop function prevents later ticks. Do not start a worker as a side effect of `createApp`, so route tests remain deterministic.

- [ ] **Step 2: Wire startup and shutdown**

Start the worker in both production `main.ts` and PGlite preview startup after obtaining the database. Stop it before closing the HTTP server/database.

- [ ] **Step 3: Update status and run release checks**

Run: `npm test`, `npm run build`, and `npm run format:check`  
Expected: all three complete successfully; docs distinguish PGlite coverage from PostgreSQL coverage.

- [ ] **Step 4: Run PostgreSQL verification when a configured test server is available**

Run: `npm run test:postgres` with `TEST_DATABASE_URL` and the project migration role configured. Verify migration 012, worker concurrency, grants, and retention on real PostgreSQL; otherwise record this check as pending and keep Task 20 open.

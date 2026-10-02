# P2-06 In-App Notifications Design

**Status:** proposed for user review  
**Scope:** Phase 2, P2-06  
**Related policy:** all active farm members have equal operating access; only the Owner may add members.

## Goal

Give every active farm member an in-app inbox for schedule and low-stock alerts. Keep alerts
farm-scoped, retryable, deduplicated, and backed by the existing schedule and inventory records.
The user selected a local transactional outbox and worker, with no email or SMS delivery.

## User-approved product behavior

- A scheduled activity gets one reminder when it enters the 24-hour window before its due time,
  and one overdue alert if it remains `SCHEDULED` or `MISSED` at/after its due time. Completed,
  cancelled, and in-progress activities do not receive those alerts. Both events use database UTC
  time and stable dedupe keys.
- An active inventory item gets one alert when its movement-derived farm-wide balance is at or
  below `minimum_stock`. The alert episode resolves when balance rises above the threshold. A later
  drop starts a new episode. A zero threshold follows the same `balance <= minimum_stock` rule.
- All farm members receive events, with read state per member.
- Notification history is retained for 90 days, with no email or SMS delivery.

## Proposed implementation details

- The local worker polls every 60 seconds and starts with both the API and PGlite preview server.
  A delayed worker emits only the event currently due; it does not backfill a missed pre-due
  reminder after the activity is overdue.
- The inbox labels generation as stale if the last successful worker poll is more than two minutes
  old.
- A member active when an event is delivered gets an inbox row; a member added later does not
  receive earlier notifications. This timing of membership is a proposal for review.
- Inbox rows and delivered outbox rows are cleaned after 90 days. A low-stock episode is not
  re-emitted while the item remains under threshold, even if its inbox row has expired.

## Architecture

The existing API server and PGlite preview server each start the same worker loop after database
initialization and stop it during shutdown. The worker scans schedule facts for due events, then
delivers pending outbox rows into the in-app inbox. Stock threshold transitions are recorded in the
same transaction as each inventory movement, so a brief recovery followed by another drop cannot
disappear between worker polls. A bootstrap scan creates the initial state for existing items.
Neither path calls an external service. Unique event keys and recipient uniqueness prevent
duplicates; `FOR UPDATE SKIP LOCKED` lets multiple server instances share delivery work safely.
Each successful poll updates a database heartbeat. The API returns that heartbeat so the UI can
show when generation is paused or stale rather than imply current alerts.

Schedule event discovery runs in database transactions. Schedule events use activity ID plus event
kind as their key. Each stock-mutating command calls a shared notification helper after all of its
movement rows are inserted but before commit, once per affected item. The helper locks the farm/item
state, reads the movement-derived balance across all lots, increments the episode number and writes
one outbox event on a healthy-to-low transition, then marks the episode's outbox and inbox rows
resolved on recovery. Evaluating the final command balance avoids false alerts during a same-item
transfer. This keeps stock events atomic with the source ledger. Delivery inserts one inbox row per current active member and
marks the outbox event delivered in the same transaction. If a database step fails, that transaction
rolls back and the pending event is available for a later retry. The worker records a safe error code
and retries pending work on the next poll. The low-stock state retains its episode counter after
history cleanup. Overdue events are not generated for activities more than 90 days past due, so
cleaned dedupe keys cannot be recreated indefinitely.

## Data and API

Migration `012_notifications_outbox.sql` adds:

- `notification_outbox`: farm, deterministic event key, event type, source identifiers, display
  snapshot, created/delivered/resolved timestamps, attempt count and safe last-error code, with a
  unique `(farm_id, event_key)` constraint.
- `farm_notification`: one row per event and recipient, with farm/source references, created time,
  optional `read_at` and `resolved_at`, and a unique `(outbox_id, recipient_id)` constraint.
- `inventory_notification_state`: current low/high state and episode counter per farm/item. Its
  episode counter is retained after inbox/outbox history cleanup to keep dedupe stable.
- `notification_worker_state`: last successful poll timestamp used to expose worker health.

The API adds a farm-scoped inbox read endpoint with unread count, bounded pagination, and worker
health, plus an idempotent mark-read endpoint. The server derives actor identity from the authenticated session;
it verifies farm membership for every request and never accepts a recipient ID from the client.
Marking one user's row read does not change another member's inbox.

## UI

Add `/notifications` using the existing dashboard page header, card, table/list, loading, empty,
and error patterns. Show the event kind, source label, time, current read state, and a link to the
related schedule or inventory item. Mark-read applies to the current member only. Replace the
dashboard's “Belum tersedia” alert placeholder with a short recent-alert preview and a link to the
inbox. Show a resolved state for stock alerts whose threshold has recovered. The layout follows the
current OpSmart shell and the chosen anti-slop `during` workflow.

## Failure handling and privacy

The worker retries pending events on a later poll after failure. Logs contain event IDs and safe
error categories, not notification body content, session data, or secrets. Inbox reads and writes
always use the authenticated actor and authorized farm. No notification may change a schedule,
inventory movement, or finance record. Dashboard/inbox API failure renders a recoverable error
state and does not block other pages.
The runtime database role receives only the permissions needed for outbox processing and member
inbox operations; it does not receive general source-ledger mutation privileges.

## Acceptance criteria

1. A schedule reminder appears once within the 24-hour window; an overdue event appears once when
   still unfinished at its due time. Cancelled/completed/in-progress activities are excluded.
2. Low-stock detection uses the sum of inventory ledger quantities across item lots. The threshold
   alert deduplicates while low, resolves after recovery, and emits a new episode after a later drop.
3. All active farm members at delivery receive an inbox row; read state is isolated per member.
4. Worker retry and concurrent worker instances cannot lose or duplicate an inbox event.
5. Farm isolation holds for reads, marks, event discovery, and recipient fan-out.
6. Ninety-day cleanup follows the retention policy above, while low-stock state prevents duplicate
   alerts until the threshold recovers, including across two worker polls.
7. UI has loading, empty, error, unread, read, source-link, and mobile/keyboard states.
8. Tests cover time-window boundaries, dedupe, recovery/re-alert, retry, concurrency, retention,
   per-member read state, tenant isolation, and route behavior. PostgreSQL multi-connection checks
   remain required before production release.

## Out of scope

Email, SMS, push, user-configurable thresholds, automatic activity transitions, stock or finance
mutations, delivery guarantees while the worker is stopped, and real-time claims beyond the
one-minute polling interval.

## Rollout

Add migration 012 and the worker/API/UI together. Until the worker is running, the inbox must show
that alert generation is paused instead of implying it is current. Verify migration, grants, retry,
and concurrent delivery on PostgreSQL before enabling this feature in a shared production
environment.

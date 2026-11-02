# Kolab Daily Standup Sync Implementation Plan

## Approved behavior

- Run a server-side Playwright worker after 12.00 WIB; users do not need an active browser at send time.
- Send only an OpSmart report that was published by its owner, to the Kolab session linked by that same OpSmart user.
- Combine the three published standup fields into Kolab's single daily-report field.
- Keep each account's browser state encrypted at rest. Never collect or retain its password.
- Check Kolab's missing-report list before submitting; do not blindly repeat an uncertain submission.

## Files

- `db/migrations/015_kolab_standup_sync.sql`, `db/runtime-grants.sql`: per-user encrypted session and durable delivery state.
- `src/shared/domain.ts`, `src/shared/errors.ts`: delivery states and safe integration errors.
- `src/modules/kolab-sync/contracts.ts`, `session.ts`, `service.ts`, `automation.ts`, `worker.ts`: validation, encryption, account linking, UI automation, and scheduled delivery.
- `src/modules/standups/service.ts`: enqueue a delivery in the report-publication transaction.
- `src/server/app.ts`, `src/server/main.ts`: authenticated session routes and production worker lifecycle.
- `scripts/kolab-connect.mjs`, `package.json`, lockfile: one-time local login-state capture using Playwright.
- `src/client/standups.tsx`, `docs/daily-standup.md`, `.env.example`: account linking, delivery status, and setup/deployment guidance.

## Execution tasks

1. Add the Playwright runtime dependency and the local helper that lets each member sign into their own Kolab account, then exports a state file to the OS temp directory.
2. Add migration 015 and runtime grants for encrypted per-user session state and a durable, idempotent delivery queue.
3. Validate and AES-256-GCM encrypt imported state. Bind every read/write to the authenticated OpSmart actor. Enqueue only when a report is published.
4. Add a Playwright worker that runs only after the WIB cutoff, uses one isolated context per member, checks whether the target date is still missing, verifies the modal date, submits, and records the result. Ambiguous outcomes require review instead of automatic resubmission.
5. Add the Standup connection panel with setup steps, status, upload, retry, and disconnect actions.
6. Document required environment configuration and the always-on Chromium-capable deployment. Run typecheck/build only; do not submit a live report during implementation.

## Acceptance checks

- A member can link only their own Kolab session from an OpSmart-authenticated request.
- Raw session state never reaches logs or plaintext database columns.
- Unpublished drafts, reports before noon, and reports belonging to other users are never submitted.
- Repeated worker ticks cannot claim the same job concurrently; ambiguous sends are not retried blindly.
- Expired sessions and changed Kolab forms produce a visible recovery state.
- The browser helper and worker target only `https://absen.kolab.top`.

## Review focus

- Cookie and storage-state validation rejects other origins and oversized files.
- Worker transactions end before any browser/network work begins.
- Queue status and retry transitions remain consistent with `shared/domain.ts` and migration constraints.
- The target date shown by Kolab matches the queued OpSmart report before the save action.
- UI upload, error, focus, and narrow-screen states remain usable.

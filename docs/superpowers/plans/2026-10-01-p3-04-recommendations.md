# P3-04 Recommendations Implementation Plan

**Status:** Desain disetujui pada 2026-10-01; rencana menunggu tinjauan. Belum ada kode P3-04.

> **For agentic workers:** Use `superpowers:executing-plans` after the owner approves this plan. Do not write application code until all source gates below pass. Work in the approved Git worktree; do not push or merge without explicit approval.

**Goal:** Deliver farm-scoped, deterministic recommendations with traceable farm evidence, citations to approved SOP revisions, and completion/dismissal state per member.

**Architecture:** Reuse the existing `Database.transaction`, farm membership checks, `command` idempotency helper, Express app, React shell, and Zod. Evaluate an authorized farm against its current recorded facts and the RAG-02 source registry. Persist immutable recommendation snapshots by rule/version/evidence fingerprint. Store each member's state separately and append every actual state change. The source farm tables remain read-only; snapshot and personal-state writes stay inside recommendation tables.

**Tech Stack:** TypeScript, Express, React, React Router, Zod, PostgreSQL, the existing `Database`/`Sql` adapters, and `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-30-p3-04-recommendations-design.md`

## Global Constraints

- Apply the authorized `farmId` and actor membership in every farm evidence query and status command.
- Read source farm records only; P3-04 writes may touch recommendation snapshots, member state, append-only events, and command receipts.
- Activate no production rule until its SOP source is approved, current, rights-cleared, and available from the RAG-02 registry.
- Keep the runtime rule catalog empty until at least one matching rule/SOP pair is approved; tests may use synthetic fixtures only.
- Do not use LLMs, predictions, survival/growth/feed-efficiency metrics, automatic actions, or unsupported unit conversions.
- Follow the approved metric and HPP definitions in `docs/decisions/metric-definitions.md` and `docs/decisions/finance-policy.md`.
- Keep API errors safe, status changes idempotent, and member state private to that member.
- UI must use the existing OpSmart shell and dashboard patterns, remain keyboard-accessible, and work without horizontal overflow at phone widths.

## Review Focus

1. A new farm member reads an existing recommendation: absent personal state must appear as `OPEN` without requiring a bulk state row.
2. An SOP is revoked or expires after a recommendation was stored: it must no longer appear active, while its prior snapshot remains readable as history.
3. Concurrent evaluation of identical evidence: exactly one snapshot must exist and neither request may overwrite prior evidence.
4. A source record has a different or missing unit, a stale timestamp, or incomplete HPP evidence: the evaluator must abstain with a stable reason.
5. A member's session attempts to read or change another farm's recommendation: the API must deny it without revealing the foreign record.

## Gates Before Code

1. RAG-01 approves corpus allowlist, ownership and rights, audience, retention, revocation, provider boundary, and privacy policy. The owner selected an internally supplied SOP with clear usage rights as the intended first-source route on 2026-10-01; the actual file and its owner/rights evidence, audience, applicability, version, and review/expiry dates are still required before a source can be approved.
2. RAG-02 provides an authoritative source registry with revision/hash, approval and expiry state, and section/page citations. P3-04 must consume it instead of maintaining a duplicate registry.
3. Product approves at least one specific rule and its matching SOP source before that rule is enabled for farm members. Until then, production evaluation returns no active recommendations; tests use synthetic SOP fixtures only.
4. Preserve the approved metric and finance definitions. Do not add survival, growth, feed-efficiency, or mixed-unit formulas.

## Files

- Create: `db/migrations/016_recommendations.sql` after RAG-02 migration 015.
- Modify: `db/runtime-grants.sql`, `src/server/app.ts`, `src/client/routes.ts`, `src/client/main.tsx`, `src/client/styles.css`.
- Create: `src/modules/recommendations/contracts.ts`, `src/modules/recommendations/evaluator.ts`, `src/modules/recommendations/queries.ts`, `src/modules/recommendations/service.ts`, `src/client/recommendations.tsx`.
- Create: `tests/recommendations.test.ts`, `tests/postgres/recommendations.test.ts`.
- Update: `docs/feature-status.md`, `docs/implementation-roadmap.md`, and `docs/verification.md` after acceptance checks pass.

## Implementation Steps

### 1. Pure evaluator and evidence contracts

- [ ] **Test first:** add `matchesWithCurrentEvidenceAndApprovedCitation`, `abstainsOnMissingOrStaleEvidence`, `abstainsOnUnitMismatch`, `abstainsOnIncompleteHpp`, `abstainsOnUnapprovedRevokedOrExpiredSop`, and `abstainsOnUnsupportedMetric` to `tests/recommendations.test.ts`. Assert abstention returns a stable reason code and no recommendation text.
- [ ] Define `RecommendationRule`, `FarmEvidence`, `SopCitation`, and `EvaluationResult` in `src/modules/recommendations/contracts.ts`. `SopCitation` must adapt the approved export from RAG-02 rather than create a second source registry.
- [ ] Expose the pure evaluator as `evaluateRule(rule, evidence, sop): EvaluationResult`; it does not query, persist, call an LLM, or mutate a farm record.
- [ ] Keep `productionRules` empty until gates 1–3 pass. Test-only rules must not be imported by runtime code.
- [ ] Run: `npx tsx --test tests/recommendations.test.ts`.

### 2. Current farm evidence and immutable recommendation snapshots

- [ ] **Test first:** add `identicalEvidenceReusesSnapshot`, `changedEvidenceCreatesHistory`, `concurrentEvaluationCreatesOneSnapshot`, and `revokedSopMovesSnapshotToHistory` to the focused service/PostgreSQL tests.
- [ ] Add migration 016 with farm-scoped instance rows for rule/version, trigger snapshot, evaluated time, source references, SOP revision/citation, and evidence fingerprint. Add the unique key `(farm_id, rule_id, rule_version, evidence_fingerprint)` plus indexes for current and historical listing.
- [ ] Implement `listFarmEvidence(tx, farmId)` as read-only SQL with membership and farm filters applied in the query. Preserve exact source record IDs/timestamps; accept only the approved RAG-02 revision. HPP evidence requires a current completeness marker; quantities from unlike units stay separate.
- [ ] Implement `evaluateAndListRecommendations(db, actorId, farmId)` using one farm-scoped transaction. Deduplicate concurrent identical evaluations; never overwrite earlier snapshots.
- [ ] Do not pre-create `OPEN` rows for every farm member. An absent personal state means `OPEN`; insert/update only that member's explicit `COMPLETED` or `DISMISSED` state. This also covers members who join after a snapshot exists.
- [ ] The response distinguishes current matches from historical snapshots. A revoked/expired SOP or no-longer-matching trigger cannot appear active, but its prior snapshot remains readable with a historical label.
- [ ] Add least-privilege runtime grants: SELECT/INSERT for snapshots, SELECT/INSERT for member state/events, and only the necessary member-state UPDATE columns. No source ledger UPDATE/DELETE grants.

### 3. Per-member status command and audit

- [ ] **Test first:** add `absentMemberStateReadsOpen`, `memberStatusIsPrivate`, `statusChangeAppendsActorAndTime`, `sameIdempotencyKeyReplays`, and `conflictingIdempotencyReplayFails`. Verify one member's status leaves every other member `OPEN`.
- [ ] Implement the status command with the existing `command` helper and `command_receipt`; validate farm membership and that the recommendation belongs to that farm.
- [ ] Append a status event only when the state actually changes. Make the history table append-only in SQL and deny runtime UPDATE/DELETE.
- [ ] The user-triggered API exposes only status changes. It has no command for schedules, inventory, costs, harvest, cycles, or IoT.

### 4. Farm-scoped API

- [ ] **Test first:** add `memberCanListFarmRecommendations`, `unauthenticatedRequestIsRejected`, `foreignFarmIsDenied`, `invalidStatusIsRejected`, `unknownRecommendationIsRejected`, and `statusRetryIsIdempotent` to `tests/recommendations.test.ts`.
- [ ] Add `GET /api/farms/:farmId/recommendations` and `POST /api/farms/:farmId/recommendations/:recommendationId/status` in `src/server/app.ts`; resolve identity through `requireActor` and apply membership scope in the service transaction. The GET may persist only deduplicated recommendation snapshots during evaluation; it must never mutate farm source data.
- [ ] Use existing safe errors and Zod contracts. Do not accept actor or farm authority from the request body.

### 5. Recommendations page

- [ ] Add `/recommendations` to `pages`, route registration, navigation icon mapping, and the existing shell. Reuse dashboard typography, surfaces, spacing, and existing icons/components.
- [ ] Render rule/version, categorical evidence completeness, trigger, explanation, farm source links/times, SOP revision/section citation, and manual action.
- [ ] Implement loading, retryable error, no-active-rule, no-match, evidence-abstained, and historical states. Complete/dismiss actions change only the signed-in member's state.
- [ ] Apply the repository `antislop` skill in the agreed During mode; keep keyboard-accessible actions and responsive layout. Add no animation library or new image assets.

### 6. Regression and release checks

- [ ] Run focused service/UI tests and `tests/postgres/recommendations.test.ts` against a disposable PostgreSQL database. Verify fresh migration 001–016, runtime grants, immutable snapshots/events, and member isolation.
- [ ] Run the full suite serially: `npx tsx --test --test-concurrency=1 tests/*.test.ts` and `npm run test:postgres`.
- [ ] Run `npm run build` and `npm run format:check`; inspect `/recommendations` at desktop and phone widths, including empty/error/abstention states.
- [ ] Update current status and verification docs only after all applicable checks pass. Keep P3-04 marked partially gated until one real rule/SOP pair is approved and activated.

## Acceptance Checklist

- Every active suggestion includes rule/version, `asOf`, trigger, readable reason, farm source IDs/times, evidence completeness, manual action, and a current approved SOP citation.
- Missing, stale, incomparable, incomplete, or unapproved evidence yields abstention.
- Identical evidence does not duplicate a snapshot; new evidence does not overwrite history.
- A member's state and history are private to that member and cannot affect other members or source facts.
- Farm isolation, keyboard use, responsive layout, loading/error/empty states, and safe retry pass.
- No LLM, prediction, automatic action, provider call, or source-farm mutation is introduced.

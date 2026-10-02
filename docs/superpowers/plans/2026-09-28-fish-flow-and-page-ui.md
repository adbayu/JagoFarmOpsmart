# Fish Flow and Page UI Implementation Plan

**Goal:** Complete Task 04 fish pond list/detail editing and align existing pages with the dashboard visual language.

**Architecture:** Keep farm-scoped unit commands and the current React router. Extend the Pond data already present in the schema, add one scoped read query for related cycles, and build a fish-only detail page. Reuse the dashboard palette, generated farm art, navigation icons, and shared card/header styles across current routes.

**Tech stack:** TypeScript, React, Express, PostgreSQL/PGlite-compatible SQL, CSS.

**Source requirements:** `docs/implementation-roadmap.md` Task 04; `docs/api-contracts.md` route map; user request to follow the dashboard UI.

## Work

- [x] Extend fish unit input, summary, query, and command handling with Pond `condition`; preserve owner scope and idempotency.
- [x] Add a read-only farm-scoped fish cycle list endpoint for one active pond. Keep cycle creation for Task 07.
- [x] Add `/farm/fish/:unitId` with loading, error, empty cycle, edit, and archive states; link to it from the fish registry.
- [x] Apply the dashboard's image-backed headers, white cards, forest accents, iconography, and responsive spacing to farm, unit, and existing placeholder pages.
- [x] Update status/API documentation; inspect desktop and mobile browser views and run build/typecheck/format checks.

## Review focus

- An ayam or tanaman unit ID must not appear as a fish detail page.
- A farm owned by another account must not expose cycles or pond details.
- Failed saves must keep the user's form input and idempotency key.
- A blank Pond condition must be removable without changing other attributes.
- All current routes must remain honest about modules that have no implementation.

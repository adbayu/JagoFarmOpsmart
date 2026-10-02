# Cycle and Observation Flow

**Goal:** Complete Task 07 with farm-scoped cycle creation, lifecycle transitions, typed details, and explicit monitoring observations for fish, chicken, and crops.

**Architecture:** Reuse `command()` for every write and the current farm/unit/commodity foreign keys. Add a new append-only migration for observation records. Keep commodity creation separate from cycle creation so each command has one clear receipt. Expose list/detail and a cycle workspace in the existing dashboard shell.

## Work

- [x] Add contracts and migration for commodity selection, cycle transitions, and typed observations.
- [x] Implement farm-scoped queries and transactional services with type and status guards.
- [x] Wire HTTP routes and the cycle UI, including links from each unit type.
- [x] Update roadmap/status/API docs and verify build, format, and responsive preview.

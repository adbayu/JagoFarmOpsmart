# Chicken Unit Flow Implementation Plan

**Goal:** Complete Task 05 with a type-safe chicken coop detail page and the dashboard visual language.

**Architecture:** Reuse the existing farm-scoped unit GET/PATCH/archive endpoints and shared unit form fields. Add one client route and a detail link for CHICKEN units; keep cycle creation for Task 07.

**Tech stack:** TypeScript, React, React Router, CSS, existing Express unit API.

**Source:** `docs/implementation-roadmap.md` Task 05 and the finished fish detail flow.

## Work

- [x] Link chicken rows to `/farm/chicken/:unitId` and register the route and breadcrumb.
- [x] Build the chicken detail with type guard, real loading/error states, Coop facts, edit, and archive confirmation using the existing commands.
- [x] Reuse the dashboard header art and card styles; inspect desktop and mobile layouts.
- [x] Update API/status docs and run build and formatting checks.

## Review focus

- A fish or crop unit ID must not render as a chicken coop.
- Data from a different farm must not appear through the detail route.
- Invalid capacity must remain blocked by the existing form and server contract.
- A failed save must keep the entered fields and idempotency key for retry.
- The chicken detail must not show pond depth, pond condition, or pH.

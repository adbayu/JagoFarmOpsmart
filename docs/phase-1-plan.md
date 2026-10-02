# Phase 1 — architecture and foundation

Goal: a small, executable technical reference for implementing the MVP without redesign.
Execution: inline in this task, as requested. Full MVP, deployment and third-party integrations are excluded.

## Inspection and intent

The supplied working directory contained only empty work/ and outputs/ folders: no repository,
source, manifest, database, auth, router, state manager, design system, tests or formatter.
No existing stack is replaced. This new project is isolated in outputs/jagofarm-opsmart.
Node 22.20.0/npm 11.19.1 are installed; Docker daemon is unavailable.
Source: supplied Phase 1 brief, master prompt and original Feature Breakdown read from Downloads.
The supplied PNG is the brand asset. These are requirements, not evidence of implemented features.

## Decisions and alternatives

- Select one TypeScript package: React/Vite client, Express API, PostgreSQL via pg, Zod boundaries.
  Easier explicit transaction examples than adding an ORM; SQL is the schema authority.
- Next.js full-stack would reduce servers but add server/client framework conventions. Separate
  microservices add deployment and transaction cost. Neither is needed for this foundation.
- Farm-scoped modular monolith; shared units/statuses/errors; module-owned service/contracts.
- Typed unit/cycle subtype tables preserve fish/chicken/crop distinctions. Lots preserve harvest provenance.
- UUID IDs, numeric quantities (3 decimals), integer IDR minor units, no financial floats.
- A farm row lock serializes mutation examples. This is a documented throughput limit, replaceable
  with ordered per-lot locks without changing service contracts when measured load justifies it.
- Identity is an injected trusted server boundary, denied by default; owner access only in examples.
- Financial recognition/valuation follows the approved `finance-mvp-v1` policy;
  HPP returns unavailable until its source data and completeness checks pass.

## Execution sequence

1. Establish package, strict TS, scripts and initial executable PostgreSQL migration.
2. Define statuses, units, validation, decimal helpers and module contracts.
3. Implement one transaction wrapper with farm authorization/idempotency, consumption and multi-item sale examples.
4. Establish minimal React shell, routes and accessible reusable states; label unimplemented pages.
5. Write glossary, invariants, database/API reference and bounded remaining-MVP tasks.
6. Run real migration/transaction tests in PGlite, typecheck, build and formatting checks.
   Provide a separate multi-connection PostgreSQL test; report inability to execute if DB absent.

## Review focus

Cross-farm references; key reuse with different payload; simultaneous overselling; rollback after
partial writes; exact fractional quantities and money; mixed harvest origins in sales;
missing or incomplete finance source data.
Tests must exercise these where implemented, with remaining gates explicit in the roadmap.

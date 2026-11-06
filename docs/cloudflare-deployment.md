# Cloudflare deployment

This configuration publishes a separate staging Worker at
`opsmart-cloudflare-staging.hllzrd.workers.dev`. The production domain
`opsmart.jagofarm.dev` remains attached to the existing Worker until the old
database is exported, imported, and verified. The staging Worker serves the
Vite build from Static Assets and forwards `/api/*` requests to one
SQLite-backed Durable Object. That object runs the existing PostgreSQL schema
through PGlite, with the Cloudflare-compatible `@dotdo/pglite` fork.

The Durable Object stores a gzip PGlite data-directory snapshot in its own
SQLite storage. It writes a new snapshot after each transaction that changes
data, verifies a SHA-256 checksum when loading, and swaps snapshots atomically.
Snapshots are currently capped at 256 MiB. Requests to the database run one at
a time in this first Cloudflare deployment; this is suitable for a small
single-farm rollout, not a horizontally scaled production database.

The Worker build is about 15 MiB before gzip and uses a community PGlite fork
last published in January 2026. Treat that dependency as an early-stage runtime
choice and review it before relying on the service for critical writes. The
Cloudflare PGlite build does not include PL/pgSQL, so the three PL/pgSQL trigger
blocks are omitted only in the Worker migration runner. The SQL adapter blocks
updates/deletes to inventory and waste history and restricts standup writes to
the existing protected upsert. PostgreSQL migrations used by local and
Kroombox deployments remain unchanged.

Cloudflare setup is described in `wrangler.jsonc`. Required compatibility is
`nodejs_compat`; the cron trigger runs the existing notification delivery tick
once per minute. The Kolab worker remains disabled because its current
Playwright Chromium automation cannot run in Workers. No Kolab session secret
is configured.

Build and run locally with `npm run dev:cloudflare`. Use `npm run
build:cloudflare` to build the UI, run type checks, and ask Wrangler to prepare
the Worker bundle without deploying. `npm run deploy:cloudflare` publishes the
staging Worker and its static assets. Its `APP_ORIGIN` is set to the staging
hostname so authentication checks use the correct origin. Production cutover
requires changing the Worker name and `APP_ORIGIN` only after the data and
runtime have been reviewed.

The current server data is not copied by deployment. This Worker initializes a
new database from the 15 schema migrations. There is no verified export of the
old hosting database in this checkout, so existing accounts, farms, and records
are not migrated. Do not cut over until those records are exported and imported,
or the owner confirms the new database can start empty. Do not copy live
database files while the source is running.

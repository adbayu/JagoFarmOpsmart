# P3-03 — Knowledge Center source registry (local gated slice)

**Status:** local source-registry slice implemented on `codex/p3-03-knowledge-center`;
typecheck and build pass. Database migration and visual preview remain unverified.

## Scope

Build a farm-aware Knowledge Center for registering and reviewing internal SOPs.
Each source is `SHARED` or scoped to the active farm and starts `PENDING_REVIEW`.
Approval records the actor and time. A source is unavailable to future retrieval
as soon as it expires or is revoked; its uploaded bytes are purged within 24 hours
and audit metadata is retained for 90 days. All farm members can manage sources.

This slice stores original PDF, Markdown, and text files in the configured
PostgreSQL database. The 5 MiB size limit is an implementation cap. It does not
extract text, create chunks or embeddings, run retrieval, or call external services.
Sources remain unusable by an assistant until the owner supplies the actual SOP and
rights evidence and separately approves hosting, retention, provider, and cost gates.

## Steps

1. Add migration 016 for source metadata, raw file bytes, append-only events, limited
   runtime grants, and bounded retention purge.
2. Add farm-scoped commands and queries for create, attach, approve, revoke, and list.
   Validate extension, file signature, UTF-8 text, size, hash, rights evidence, and
   review dates; use the existing command receipt pattern for retries.
3. Add the responsive `/knowledge` page to the dashboard shell with upload, source
   scope, review state, approval/revocation, loading, empty, error, and retry states.
4. Update the roadmap and verification notes; leave RAG ingestion, vector search,
   assistant answers, and P3-04 activation explicitly gated.

## Verification boundary

Do not claim provider, vector, PostgreSQL deployment, retention-worker, or source
quality verification without the corresponding environment and actual SOP. No SOP
has been supplied to this worktree. Automated tests are not part of this pass.

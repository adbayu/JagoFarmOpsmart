CREATE TYPE knowledge_source_scope AS ENUM ('SHARED', 'FARM');
CREATE TYPE knowledge_source_status AS ENUM (
  'PENDING_REVIEW',
  'ACTIVE',
  'REVOKED',
  'EXPIRED'
);
CREATE TYPE knowledge_source_event_type AS ENUM (
  'CREATED',
  'FILE_ATTACHED',
  'APPROVED',
  'REVOKED',
  'EXPIRED',
  'CONTENT_PURGED'
);

CREATE TABLE knowledge_source (
  id uuid PRIMARY KEY,
  scope knowledge_source_scope NOT NULL,
  farm_id uuid REFERENCES farm(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  publisher text NOT NULL CHECK (length(btrim(publisher)) BETWEEN 1 AND 200),
  rights_evidence text NOT NULL CHECK (length(btrim(rights_evidence)) BETWEEN 1 AND 2000),
  applicability text NOT NULL CHECK (length(btrim(applicability)) BETWEEN 1 AND 1000),
  version_label text NOT NULL CHECK (length(btrim(version_label)) BETWEEN 1 AND 100),
  original_reference text NOT NULL CHECK (length(btrim(original_reference)) BETWEEN 1 AND 1000),
  effective_at timestamptz NOT NULL,
  review_at timestamptz NOT NULL,
  file_name text CHECK (file_name IS NULL OR length(btrim(file_name)) BETWEEN 1 AND 180),
  media_type text CHECK (media_type IS NULL OR media_type IN ('application/pdf', 'text/markdown', 'text/plain')),
  content_sha256 char(64) CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'),
  content bytea,
  status knowledge_source_status NOT NULL DEFAULT 'PENDING_REVIEW',
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  changed_by uuid NOT NULL REFERENCES app_user(id),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_by uuid REFERENCES app_user(id),
  approved_at timestamptz,
  revoked_by uuid REFERENCES app_user(id),
  revoked_at timestamptz,
  content_purge_after timestamptz,
  metadata_purge_after timestamptz,
  content_purged_at timestamptz,
  CHECK ((scope = 'SHARED' AND farm_id IS NULL) OR (scope = 'FARM' AND farm_id IS NOT NULL)),
  CHECK (review_at > effective_at),
  CHECK (content_purged_at IS NULL OR content IS NULL),
  CHECK (
    (status = 'PENDING_REVIEW' AND approved_by IS NULL AND approved_at IS NULL AND revoked_at IS NULL)
    OR (status = 'ACTIVE' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND revoked_at IS NULL AND content IS NOT NULL AND file_name IS NOT NULL AND media_type IS NOT NULL AND content_sha256 IS NOT NULL)
    OR (status IN ('REVOKED', 'EXPIRED') AND content_purge_after IS NOT NULL AND metadata_purge_after IS NOT NULL)
  )
);

CREATE INDEX knowledge_source_farm_list_idx
  ON knowledge_source(farm_id, created_at DESC, id DESC);
CREATE INDEX knowledge_source_shared_list_idx
  ON knowledge_source(created_at DESC, id DESC) WHERE scope = 'SHARED';
CREATE INDEX knowledge_source_expiry_idx
  ON knowledge_source(review_at, id) WHERE status = 'ACTIVE';
CREATE INDEX knowledge_source_retention_idx
  ON knowledge_source(content_purge_after, metadata_purge_after, id)
  WHERE status IN ('REVOKED', 'EXPIRED');

CREATE TABLE knowledge_source_event (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES knowledge_source(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES app_user(id),
  event_type knowledge_source_event_type NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX knowledge_source_event_history_idx
  ON knowledge_source_event(source_id, occurred_at DESC, id);

CREATE FUNCTION purge_knowledge_sources(p_batch_size integer)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  purged_count bigint;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 500 THEN
    RAISE EXCEPTION 'batch size must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;

  WITH due AS (
    SELECT id
    FROM knowledge_source
    WHERE status IN ('REVOKED', 'EXPIRED')
      AND content IS NOT NULL
      AND content_purge_after <= pg_catalog.clock_timestamp()
    ORDER BY content_purge_after, id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ), purged AS (
    UPDATE knowledge_source AS source
    SET content = NULL, content_purged_at = pg_catalog.clock_timestamp(), changed_at = pg_catalog.clock_timestamp()
    FROM due
    WHERE source.id = due.id
    RETURNING source.id
  )
  INSERT INTO knowledge_source_event(id, source_id, actor_id, event_type, metadata)
  SELECT gen_random_uuid(), id, NULL, 'CONTENT_PURGED', '{}'::jsonb FROM purged;

  WITH expired AS (
    SELECT id
    FROM knowledge_source
    WHERE status IN ('REVOKED', 'EXPIRED')
      AND metadata_purge_after <= pg_catalog.clock_timestamp()
    ORDER BY metadata_purge_after, id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ), deleted_events AS (
    DELETE FROM knowledge_source_event AS event
    USING expired
    WHERE event.source_id = expired.id
    RETURNING event.source_id
  ), deleted_sources AS (
    DELETE FROM knowledge_source AS source
    USING expired
    WHERE source.id = expired.id
    RETURNING 1
  )
  SELECT count(*) INTO purged_count FROM deleted_sources;

  RETURN purged_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_knowledge_sources(integer) FROM PUBLIC;

CREATE TYPE farm_device_status AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE telemetry_quality AS ENUM ('GOOD', 'SUSPECT', 'INVALID');
CREATE TYPE farm_device_event_type AS ENUM (
  'CREATED',
  'RENAMED',
  'METRIC_ACTIVATED',
  'METRIC_RETIRED',
  'TOKEN_ROTATED',
  'REVOKED'
);

CREATE TABLE farm_device (
  id uuid PRIMARY KEY,
  farm_id uuid NOT NULL REFERENCES farm(id),
  farm_unit_id uuid NOT NULL,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status farm_device_status NOT NULL DEFAULT 'ACTIVE',
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  changed_by uuid NOT NULL REFERENCES app_user(id),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_by uuid REFERENCES app_user(id),
  revoked_at timestamptz,
  rate_limit_tokens numeric(9,6) NOT NULL DEFAULT 120
    CHECK (rate_limit_tokens BETWEEN 0 AND 120),
  rate_refilled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, farm_id),
  UNIQUE (id, farm_id, farm_unit_id),
  FOREIGN KEY (farm_id, farm_unit_id) REFERENCES farm_unit(farm_id, id),
  CHECK (
    (status = 'ACTIVE' AND revoked_by IS NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX farm_device_farm_list_idx
  ON farm_device(farm_id, created_at DESC, id DESC);

CREATE TABLE farm_device_metric (
  device_id uuid NOT NULL REFERENCES farm_device(id),
  metric_key text NOT NULL CHECK (metric_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  measurement_unit text NOT NULL
    CHECK (measurement_unit ~ '^[A-Za-z0-9][A-Za-z0-9._/%-]{0,31}$'),
  active boolean NOT NULL DEFAULT true,
  changed_by uuid NOT NULL REFERENCES app_user(id),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (device_id, metric_key, measurement_unit)
);

CREATE TABLE telemetry_reading (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  farm_unit_id uuid NOT NULL,
  reading_id varchar(128) NOT NULL
    CHECK (reading_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  metric_key text NOT NULL,
  measurement_unit text NOT NULL,
  value numeric(18,6) NOT NULL,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  quality telemetry_quality NOT NULL DEFAULT 'GOOD',
  UNIQUE (device_id, reading_id),
  FOREIGN KEY (device_id, farm_id, farm_unit_id)
    REFERENCES farm_device(id, farm_id, farm_unit_id),
  FOREIGN KEY (device_id, metric_key, measurement_unit)
    REFERENCES farm_device_metric(device_id, metric_key, measurement_unit)
);

CREATE INDEX telemetry_reading_latest_valid_idx
  ON telemetry_reading(
    farm_id,
    farm_unit_id,
    metric_key,
    measurement_unit,
    observed_at DESC,
    received_at DESC,
    id
  ) WHERE quality <> 'INVALID';
CREATE INDEX telemetry_reading_received_idx
  ON telemetry_reading(received_at, id);
CREATE INDEX telemetry_reading_device_received_idx
  ON telemetry_reading(device_id, received_at DESC, id);

CREATE TABLE farm_device_event (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL,
  farm_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES app_user(id),
  event_type farm_device_event_type NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  FOREIGN KEY (device_id, farm_id) REFERENCES farm_device(id, farm_id)
);

CREATE INDEX farm_device_event_history_idx
  ON farm_device_event(farm_id, device_id, occurred_at DESC, id);

CREATE FUNCTION prevent_farm_device_rebinding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.farm_id IS DISTINCT FROM OLD.farm_id
     OR NEW.farm_unit_id IS DISTINCT FROM OLD.farm_unit_id THEN
    RAISE EXCEPTION 'farm device binding is immutable';
  END IF;
  IF OLD.status = 'REVOKED' AND NEW.status = 'ACTIVE' THEN
    RAISE EXCEPTION 'revoked farm devices cannot be reactivated';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER farm_device_binding_immutable
BEFORE UPDATE ON farm_device
FOR EACH ROW EXECUTE FUNCTION prevent_farm_device_rebinding();

CREATE FUNCTION purge_expired_telemetry(p_batch_size integer)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted_count bigint;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 1000 THEN
    RAISE EXCEPTION 'batch size must be between 1 and 1000'
      USING ERRCODE = '22023';
  END IF;

  WITH expired AS (
    SELECT id
    FROM telemetry_reading
    WHERE received_at < pg_catalog.clock_timestamp() - interval '90 days'
    ORDER BY received_at, id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM telemetry_reading AS reading
    USING expired
    WHERE reading.id = expired.id
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM deleted;

  RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_expired_telemetry(integer) FROM PUBLIC;

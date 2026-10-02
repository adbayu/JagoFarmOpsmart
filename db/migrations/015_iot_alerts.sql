ALTER TABLE farm_device
  ADD COLUMN stale_alert_checked_at timestamptz;

CREATE INDEX farm_device_stale_alert_scan_idx
  ON farm_device(stale_alert_checked_at ASC NULLS FIRST,id)
  WHERE status='ACTIVE';

CREATE TABLE farm_device_alert_config (
  device_id uuid NOT NULL,
  metric_key text NOT NULL,
  measurement_unit text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  low_threshold numeric(18,6),
  high_threshold numeric(18,6),
  stale_after_seconds integer,
  changed_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (device_id, metric_key, measurement_unit, version),
  FOREIGN KEY (device_id, metric_key, measurement_unit)
    REFERENCES farm_device_metric(device_id, metric_key, measurement_unit),
  CHECK (
    low_threshold IS NULL OR high_threshold IS NULL
    OR low_threshold < high_threshold
  ),
  CHECK (
    stale_after_seconds IS NULL
    OR stale_after_seconds BETWEEN 60 AND 7776000
  )
);

CREATE INDEX farm_device_alert_config_latest_idx
  ON farm_device_alert_config(device_id, metric_key, measurement_unit, version DESC);

CREATE TABLE farm_device_alert_episode (
  id uuid PRIMARY KEY,
  farm_id uuid NOT NULL,
  device_id uuid NOT NULL,
  metric_key text NOT NULL,
  measurement_unit text NOT NULL,
  condition_kind text NOT NULL CHECK (condition_kind IN ('LOW', 'HIGH', 'STALE')),
  config_version integer NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  open_reason text NOT NULL CHECK (open_reason IN ('THRESHOLD', 'STALE_TIMEOUT')),
  resolved_reason text CHECK (
    resolved_reason IN ('RECOVERED', 'CONFIG_CHANGED', 'METRIC_DISABLED', 'DEVICE_REVOKED')
  ),
  opened_by uuid REFERENCES app_user(id),
  resolved_by uuid REFERENCES app_user(id),
  source_reading_id uuid,
  source_value numeric(18,6),
  source_unit text,
  source_observed_at timestamptz,
  evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (farm_id, id),
  FOREIGN KEY (device_id, farm_id)
    REFERENCES farm_device(id, farm_id),
  FOREIGN KEY (device_id, metric_key, measurement_unit, config_version)
    REFERENCES farm_device_alert_config(device_id, metric_key, measurement_unit, version),
  CHECK (
    (resolved_at IS NULL AND resolved_reason IS NULL AND resolved_by IS NULL)
    OR (resolved_at IS NOT NULL AND resolved_reason IS NOT NULL)
  ),
  CHECK (
    (source_reading_id IS NULL AND source_value IS NULL AND source_observed_at IS NULL)
    OR (source_reading_id IS NOT NULL AND source_value IS NOT NULL AND source_observed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX farm_device_alert_episode_open_unique_idx
  ON farm_device_alert_episode(device_id, metric_key, measurement_unit, condition_kind)
  WHERE resolved_at IS NULL;
CREATE INDEX farm_device_alert_episode_history_idx
  ON farm_device_alert_episode(farm_id, device_id, opened_at DESC, id DESC);
CREATE INDEX farm_device_alert_episode_retention_idx
  ON farm_device_alert_episode(resolved_at, id)
  WHERE resolved_at IS NOT NULL;

CREATE TABLE farm_device_alert_transition (
  id uuid PRIMARY KEY,
  farm_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  transition_type text NOT NULL CHECK (
    transition_type IN ('OPENED', 'RECOVERED', 'CONFIG_CHANGED', 'METRIC_DISABLED', 'DEVICE_REVOKED')
  ),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id uuid REFERENCES app_user(id),
  reason text NOT NULL,
  source_reading_id uuid,
  source_value numeric(18,6),
  source_unit text,
  source_observed_at timestamptz,
  config_version integer NOT NULL CHECK (config_version > 0),
  FOREIGN KEY (farm_id, episode_id)
    REFERENCES farm_device_alert_episode(farm_id, id) ON DELETE CASCADE,
  CHECK (
    (source_reading_id IS NULL AND source_value IS NULL AND source_observed_at IS NULL)
    OR (source_reading_id IS NOT NULL AND source_value IS NOT NULL AND source_observed_at IS NOT NULL)
  )
);

CREATE INDEX farm_device_alert_transition_history_idx
  ON farm_device_alert_transition(farm_id, episode_id, occurred_at, id);

ALTER TABLE notification_outbox
  DROP CONSTRAINT notification_outbox_event_type_check;
ALTER TABLE notification_outbox
  ADD CONSTRAINT notification_outbox_event_type_check
    CHECK (event_type IN ('SCHEDULE_REMINDER', 'SCHEDULE_OVERDUE', 'LOW_STOCK', 'IOT_ALERT'));

CREATE FUNCTION purge_expired_iot_alert_history(p_batch_size integer)
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
    SELECT episode.id
    FROM public.farm_device_alert_episode AS episode
    WHERE episode.resolved_at < pg_catalog.clock_timestamp() - interval '90 days'
      AND NOT EXISTS (
        SELECT 1
        FROM public.notification_outbox AS outbox
        WHERE outbox.source_id = episode.id
          AND outbox.event_type = 'IOT_ALERT'
          AND outbox.delivered_at IS NULL
      )
    ORDER BY episode.resolved_at, episode.id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.farm_device_alert_episode AS episode
    USING expired
    WHERE episode.id = expired.id
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM deleted;

  RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_expired_iot_alert_history(integer) FROM PUBLIC;

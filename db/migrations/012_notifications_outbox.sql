CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY,
  farm_id uuid NOT NULL REFERENCES farm(id),
  event_key text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('SCHEDULE_REMINDER','SCHEDULE_OVERDUE','LOW_STOCK')),
  source_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  resolved_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code text,
  UNIQUE (farm_id, id),
  UNIQUE (farm_id, event_key)
);
CREATE INDEX notification_outbox_pending_idx
  ON notification_outbox(created_at, id) WHERE delivered_at IS NULL;
CREATE INDEX notification_outbox_retention_idx
  ON notification_outbox(delivered_at) WHERE delivered_at IS NOT NULL;

CREATE TABLE farm_notification (
  id uuid PRIMARY KEY,
  farm_id uuid NOT NULL,
  outbox_id uuid NOT NULL,
  recipient_id uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  resolved_at timestamptz,
  UNIQUE (outbox_id, recipient_id),
  FOREIGN KEY (farm_id, outbox_id)
    REFERENCES notification_outbox(farm_id, id) ON DELETE CASCADE
);
CREATE INDEX farm_notification_recipient_idx
  ON farm_notification(farm_id, recipient_id, created_at DESC, id DESC);
CREATE INDEX farm_notification_unread_idx
  ON farm_notification(farm_id, recipient_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TABLE inventory_notification_state (
  farm_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  is_low boolean NOT NULL DEFAULT false,
  episode_count bigint NOT NULL DEFAULT 0 CHECK (episode_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, inventory_item_id),
  FOREIGN KEY (farm_id, inventory_item_id)
    REFERENCES inventory_item(farm_id, id) ON DELETE CASCADE
);

CREATE TABLE notification_worker_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_success_at timestamptz NOT NULL
);

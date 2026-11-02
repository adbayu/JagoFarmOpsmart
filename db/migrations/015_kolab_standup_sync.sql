CREATE TYPE kolab_delivery_status AS ENUM (
  'PENDING',
  'SENDING',
  'SENT',
  'ALREADY_PRESENT',
  'NEEDS_SESSION',
  'NEEDS_REVIEW',
  'FAILED'
);

CREATE TABLE kolab_account_session (
  user_id uuid PRIMARY KEY REFERENCES app_user(id),
  encrypted_state bytea NOT NULL,
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  auth_tag bytea NOT NULL CHECK (octet_length(auth_tag) = 16),
  connected_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE kolab_standup_delivery (
  user_id uuid NOT NULL,
  report_date date NOT NULL,
  status kolab_delivery_status NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  last_error_code text CHECK (last_error_code IN (
    'SESSION_REQUIRED', 'LOGIN_REQUIRED', 'FORM_CHANGED',
    'SUBMIT_UNCERTAIN', 'NETWORK', 'TOO_OLD'
  )),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, report_date),
  FOREIGN KEY (user_id, report_date)
    REFERENCES daily_standup(user_id, report_date),
  CHECK ((status = 'SENDING') = (lease_expires_at IS NOT NULL)),
  CHECK ((status IN ('SENT', 'ALREADY_PRESENT')) = (completed_at IS NOT NULL))
);

CREATE INDEX kolab_standup_delivery_pending_idx
  ON kolab_standup_delivery(status, next_attempt_at, report_date);

INSERT INTO kolab_standup_delivery(user_id, report_date, status, attempt_count,
  next_attempt_at, created_at, updated_at)
SELECT user_id, report_date, 'PENDING', 0, now(), now(), now()
FROM daily_standup
WHERE report_date = (now() AT TIME ZONE 'Asia/Jakarta')::date
  AND published_at IS NOT NULL
ON CONFLICT(user_id, report_date) DO NOTHING;


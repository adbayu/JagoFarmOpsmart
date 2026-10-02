CREATE TABLE auth_credential (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_session (
  token_hash text PRIMARY KEY,
  auth_subject text NOT NULL REFERENCES app_user(auth_subject) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_session_subject_idx ON auth_session(auth_subject);
CREATE INDEX auth_session_expiry_idx ON auth_session(expires_at);
CREATE TABLE auth_login_throttle (
  email_hash text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz
);

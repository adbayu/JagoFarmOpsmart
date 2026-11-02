CREATE TABLE standup_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 starts_on date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Jakarta')::date)
);
INSERT INTO standup_settings(id) VALUES(true);

CREATE TABLE standup_holiday_calendar (
 year integer PRIMARY KEY CHECK (year BETWEEN 2000 AND 2100),
 days jsonb NOT NULL CHECK (jsonb_typeof(days) = 'array'),
 fetched_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL
);

CREATE TABLE daily_standup (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES app_user(id),
 report_date date NOT NULL,
 version integer NOT NULL CHECK (version > 0),
 draft_plan text NOT NULL DEFAULT '' CHECK (length(draft_plan) <= 6000),
 draft_previous text NOT NULL DEFAULT '' CHECK (length(draft_previous) <= 6000),
 draft_blockers text NOT NULL DEFAULT '' CHECK (length(draft_blockers) <= 6000),
 published_plan text CHECK (length(trim(published_plan)) BETWEEN 1 AND 6000),
 published_previous text CHECK (length(published_previous) <= 6000),
 published_blockers text CHECK (length(published_blockers) <= 6000),
 published_at timestamptz,
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 UNIQUE (user_id, report_date),
 CHECK ((published_at IS NULL AND published_plan IS NULL AND published_previous IS NULL AND published_blockers IS NULL)
   OR (published_at IS NOT NULL AND published_plan IS NOT NULL AND published_previous IS NOT NULL AND published_blockers IS NOT NULL))
);
CREATE INDEX daily_standup_date_idx ON daily_standup(report_date, user_id);

CREATE TABLE standup_reminder (
 user_id uuid NOT NULL REFERENCES app_user(id),
 report_date date NOT NULL,
 claimed_at timestamptz NOT NULL,
 PRIMARY KEY(user_id, report_date)
);

CREATE TABLE standup_command_receipt (
 user_id uuid NOT NULL REFERENCES app_user(id),
 idempotency_key uuid NOT NULL,
 request_hash text NOT NULL,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(user_id, idempotency_key)
);

CREATE FUNCTION preserve_standup_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   RAISE EXCEPTION 'Standup history cannot be deleted' USING ERRCODE = '23514';
 END IF;
 IF NEW.user_id <> OLD.user_id OR NEW.report_date <> OLD.report_date
   OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at
   OR (OLD.published_at IS NOT NULL AND NEW.published_at IS NULL) THEN
   RAISE EXCEPTION 'Standup identity and publication must be preserved' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_standup_publication BEFORE UPDATE OR DELETE ON daily_standup
 FOR EACH ROW EXECUTE FUNCTION preserve_standup_publication();

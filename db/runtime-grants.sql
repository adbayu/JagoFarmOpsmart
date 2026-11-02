-- Run as a database administrator after creating these roles:
--   opsmart_migrator: LOGIN, owns the application database/schema objects and
--                     runs migrations with MIGRATION_DATABASE_URL.
--   opsmart_runtime: LOGIN, used only by the API's DATABASE_URL.
-- Give opsmart_migrator database ownership (or CREATE on schema public) before
-- running migrations. Keep both roles separate and runtime out of membership.
--   Keep opsmart_runtime out of privileged role memberships.
-- Apply with psql -v ON_ERROR_STOP=1 --file=db/runtime-grants.sql.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opsmart_migrator') THEN
    RAISE EXCEPTION 'Create role opsmart_migrator before applying runtime grants';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opsmart_runtime') THEN
    RAISE EXCEPTION 'Create role opsmart_runtime before applying runtime grants';
  END IF;
  IF pg_has_role('opsmart_runtime', 'opsmart_migrator', 'MEMBER') THEN
    RAISE EXCEPTION 'opsmart_runtime must not be a member of opsmart_migrator';
  END IF;
END;
$$;

SELECT format(
  'GRANT CONNECT ON DATABASE %I TO opsmart_runtime',
  current_database()
) \gexec

GRANT USAGE ON SCHEMA public TO opsmart_runtime;
-- Older PostgreSQL installations grant schema creation to PUBLIC by default.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO opsmart_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO opsmart_runtime;
-- createFarm uses SELECT FOR UPDATE on the identity row to serialize farm creation.
-- The API has no flow that edits display_name.
GRANT UPDATE (display_name) ON TABLE public.app_user TO opsmart_runtime;
-- Notification writes are restricted to worker lifecycle and the recipient's read state.
GRANT UPDATE (delivered_at, resolved_at, attempt_count, last_error_code)
  ON TABLE public.notification_outbox TO opsmart_runtime;
GRANT UPDATE (read_at, resolved_at)
  ON TABLE public.farm_notification TO opsmart_runtime;
GRANT UPDATE (is_low, episode_count, updated_at)
  ON TABLE public.inventory_notification_state TO opsmart_runtime;
GRANT UPDATE (last_success_at)
  ON TABLE public.notification_worker_state TO opsmart_runtime;

GRANT UPDATE ON TABLE
  public.auth_login_throttle,
  public.auth_session,
  public.farm,
  public.farm_unit,
  public.pond,
  public.coop,
  public.growing_area,
  public.farming_cycle,
  public.activity,
  public.inventory_item,
  public.inventory_lot,
  public.product,
  public.harvest,
  public.sale,
  public.sale_payment,
  public.cost_entry,
  public.cycle_cost_completion,
  public.maggot_batch,
  public.daily_standup,
  public.standup_holiday_calendar
TO opsmart_runtime;

REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM opsmart_runtime;
-- Type changes are allowed only before a cycle exists, and replace one typed
-- detail row while keeping the shared farm_unit record and its history.
GRANT DELETE ON TABLE public.pond, public.coop, public.growing_area
TO opsmart_runtime;
GRANT DELETE ON TABLE public.farm_notification, public.notification_outbox
TO opsmart_runtime;
GRANT DELETE ON TABLE public.farm_membership TO opsmart_runtime;
REVOKE UPDATE ON TABLE
  public.inventory_movement,
  public.harvest_output,
  public.sale_item,
  public.cycle_observation,
  public.circular_maggot_posting,
  public.circular_water_transfer,
  public.maggot_batch_input,
  public.maggot_batch_observation,
  public.maggot_batch_output,
  public.maggot_batch_output_use,
  public.command_receipt
FROM opsmart_runtime;

REVOKE UPDATE, DELETE ON TABLE public.circular_water_transfer FROM opsmart_runtime;

-- New migration tables default to read/insert only. Grant UPDATE explicitly
-- only when the application has a mutable lifecycle for that table.
ALTER DEFAULT PRIVILEGES FOR ROLE opsmart_migrator IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO opsmart_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE opsmart_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO opsmart_runtime;

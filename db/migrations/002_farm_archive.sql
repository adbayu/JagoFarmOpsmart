-- Keep operational records intact when an owner removes a farm from active selection.
ALTER TABLE farm ADD COLUMN archived_at timestamptz;
ALTER TABLE farm ADD COLUMN archived_by uuid REFERENCES app_user(id);
ALTER TABLE farm ADD CONSTRAINT farm_archive_actor_check
  CHECK ((archived_at IS NULL) = (archived_by IS NULL));
CREATE INDEX farm_owner_active_idx ON farm(owner_id,created_at DESC,id DESC)
  WHERE archived_at IS NULL;

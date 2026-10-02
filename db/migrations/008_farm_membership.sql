CREATE TABLE farm_membership (
  farm_id uuid NOT NULL REFERENCES farm(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  added_by uuid NOT NULL REFERENCES app_user(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, user_id)
);

CREATE INDEX farm_membership_user_idx ON farm_membership(user_id, farm_id);

INSERT INTO farm_membership(farm_id, user_id, added_by, joined_at)
SELECT id, owner_id, owner_id, created_at FROM farm;

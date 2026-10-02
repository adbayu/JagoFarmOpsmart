CREATE TABLE circular_water_transfer (
  id uuid PRIMARY KEY,
  farm_id uuid NOT NULL,
  source_unit_id uuid NOT NULL,
  source_type farming_type NOT NULL DEFAULT 'FISH' CHECK (source_type = 'FISH'),
  target_unit_id uuid NOT NULL,
  target_type farming_type NOT NULL DEFAULT 'CROP' CHECK (target_type = 'CROP'),
  quantity_liters numeric(18,3) NOT NULL CHECK (quantity_liters > 0),
  transfer_date date NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, id),
  FOREIGN KEY (farm_id, source_unit_id, source_type)
    REFERENCES farm_unit(farm_id, id, farming_type),
  FOREIGN KEY (farm_id, target_unit_id, target_type)
    REFERENCES farm_unit(farm_id, id, farming_type)
);

CREATE INDEX circular_water_transfer_farm_date_idx
  ON circular_water_transfer(farm_id, transfer_date DESC, created_at DESC, id);

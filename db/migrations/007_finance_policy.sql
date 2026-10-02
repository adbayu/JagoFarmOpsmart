CREATE TABLE cycle_cost_completion (
 farm_id uuid NOT NULL,
 cycle_id uuid NOT NULL,
 completed_at timestamptz NOT NULL DEFAULT now(),
 completed_by uuid NOT NULL REFERENCES app_user(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(farm_id,cycle_id),
 FOREIGN KEY(farm_id,cycle_id) REFERENCES farming_cycle(farm_id,id)
);

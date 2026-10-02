-- Explicit monitoring facts; notes are never parsed into numeric metrics.
CREATE TABLE cycle_observation (
 id uuid PRIMARY KEY,
 farm_id uuid NOT NULL,
 cycle_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES app_user(id),
 observed_at timestamptz NOT NULL,
 population_loss integer CHECK (population_loss > 0),
 average_weight_g numeric(18,3) CHECK (average_weight_g > 0),
 condition_notes text CHECK (condition_notes IS NULL OR length(trim(condition_notes)) > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(farm_id,id),
 FOREIGN KEY(farm_id,cycle_id) REFERENCES farming_cycle(farm_id,id),
 CHECK (population_loss IS NOT NULL OR average_weight_g IS NOT NULL OR condition_notes IS NOT NULL)
);
CREATE INDEX cycle_observation_cycle_time_idx
 ON cycle_observation(farm_id,cycle_id,observed_at DESC,id DESC);

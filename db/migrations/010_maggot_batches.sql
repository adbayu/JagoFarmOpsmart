CREATE TYPE maggot_batch_status AS ENUM ('OPEN','COMPLETED');

CREATE TABLE maggot_batch (
 id uuid PRIMARY KEY,
 farm_id uuid NOT NULL REFERENCES farm(id),
 started_on date NOT NULL,
 media text NOT NULL CHECK (length(trim(media)) BETWEEN 1 AND 200),
 status maggot_batch_status NOT NULL DEFAULT 'OPEN',
 notes text CHECK (notes IS NULL OR length(notes) <= 2000),
 completion_note text CHECK (completion_note IS NULL OR length(trim(completion_note)) BETWEEN 1 AND 1000),
 created_by uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_by uuid REFERENCES app_user(id),
 completed_at timestamptz,
 UNIQUE (farm_id,id),
 CHECK ((status='COMPLETED')=(completed_at IS NOT NULL)),
 CHECK ((status='COMPLETED')=(completed_by IS NOT NULL)),
 CHECK ((status='COMPLETED')=(completion_note IS NOT NULL))
);
CREATE INDEX maggot_batch_farm_started_idx ON maggot_batch(farm_id,started_on DESC,id DESC);

CREATE TABLE maggot_batch_input (
 id uuid PRIMARY KEY,
 farm_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 waste_id uuid NOT NULL,
 quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
 unit measure_unit NOT NULL,
 created_by uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (farm_id,id),
 FOREIGN KEY(farm_id,batch_id) REFERENCES maggot_batch(farm_id,id),
 FOREIGN KEY(farm_id,waste_id) REFERENCES waste_record(farm_id,id),
 CHECK (unit NOT IN ('UNIT','HEAD','SEED') OR quantity=trunc(quantity))
);
CREATE INDEX maggot_batch_input_waste_idx ON maggot_batch_input(farm_id,waste_id);

CREATE TABLE maggot_batch_observation (
 id uuid PRIMARY KEY,
 farm_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 observed_at timestamptz NOT NULL,
 observation text NOT NULL CHECK (length(trim(observation)) BETWEEN 1 AND 1000),
 created_by uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(farm_id,batch_id) REFERENCES maggot_batch(farm_id,id)
);
CREATE INDEX maggot_batch_observation_time_idx ON maggot_batch_observation(farm_id,batch_id,observed_at,id);

CREATE TABLE maggot_batch_output (
 id uuid PRIMARY KEY,
 farm_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 harvested_at timestamptz NOT NULL,
 quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
 unit measure_unit NOT NULL,
 notes text CHECK (notes IS NULL OR length(notes) <= 1000),
 created_by uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(farm_id,id),
 UNIQUE(farm_id,batch_id,id),
 FOREIGN KEY(farm_id,batch_id) REFERENCES maggot_batch(farm_id,id),
 CHECK (unit NOT IN ('UNIT','HEAD','SEED') OR quantity=trunc(quantity))
);
CREATE INDEX maggot_batch_output_time_idx ON maggot_batch_output(farm_id,batch_id,harvested_at,id);

CREATE TABLE maggot_batch_output_use (
 id uuid PRIMARY KEY,
 farm_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 output_id uuid NOT NULL,
 quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
 purpose text NOT NULL CHECK (length(trim(purpose)) BETWEEN 1 AND 300),
 created_by uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(farm_id,batch_id) REFERENCES maggot_batch(farm_id,id),
 FOREIGN KEY(farm_id,batch_id,output_id) REFERENCES maggot_batch_output(farm_id,batch_id,id)
);
CREATE INDEX maggot_batch_output_use_idx ON maggot_batch_output_use(farm_id,output_id);

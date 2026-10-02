CREATE TYPE waste_status AS ENUM ('RECORDED','PROCESSING','PROCESSED','REUSED','DISPOSED');

CREATE TABLE waste_record (
 id uuid PRIMARY KEY,
 farm_id uuid NOT NULL REFERENCES farm(id),
 source text NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 200),
 quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
 unit measure_unit NOT NULL,
 waste_date date NOT NULL,
 status waste_status NOT NULL DEFAULT 'RECORDED',
 usage text CHECK (usage IS NULL OR length(trim(usage)) BETWEEN 1 AND 300),
 notes text CHECK (notes IS NULL OR length(notes) <= 2000),
 created_by uuid NOT NULL REFERENCES app_user(id),
 updated_by uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (farm_id,id),
 CHECK (status <> 'REUSED' OR usage IS NOT NULL),
 CHECK (unit NOT IN ('UNIT','HEAD','SEED') OR quantity=trunc(quantity))
);
CREATE INDEX waste_record_farm_date_idx ON waste_record(farm_id,waste_date DESC,id DESC);

CREATE TABLE waste_status_event (
 id uuid PRIMARY KEY,
 farm_id uuid NOT NULL,
 waste_id uuid NOT NULL,
 from_status waste_status,
 to_status waste_status NOT NULL,
 sequence_no integer NOT NULL CHECK (sequence_no > 0),
 reason text CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 300),
 changed_by uuid NOT NULL REFERENCES app_user(id),
 changed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(farm_id,waste_id) REFERENCES waste_record(farm_id,id),
 UNIQUE(farm_id,waste_id,sequence_no),
 CHECK ((from_status IS NULL)=(to_status='RECORDED'))
);
CREATE INDEX waste_status_event_record_idx ON waste_status_event(farm_id,waste_id,changed_at,id);

CREATE FUNCTION protect_waste_status_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Waste status events are append-only' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER waste_status_event_immutable
 BEFORE UPDATE OR DELETE ON waste_status_event FOR EACH ROW
 EXECUTE FUNCTION protect_waste_status_event();

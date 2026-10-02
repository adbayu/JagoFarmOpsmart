CREATE TABLE circular_maggot_posting (
 id uuid PRIMARY KEY,
 farm_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 output_id uuid NOT NULL,
 movement_id uuid NOT NULL,
 quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
 unit measure_unit NOT NULL,
 reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
 created_by uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(farm_id,id),
 UNIQUE(farm_id,movement_id),
 FOREIGN KEY(farm_id,batch_id,output_id)
   REFERENCES maggot_batch_output(farm_id,batch_id,id),
 FOREIGN KEY(farm_id,movement_id) REFERENCES inventory_movement(farm_id,id),
 CHECK (unit NOT IN ('UNIT','HEAD','SEED') OR quantity=trunc(quantity))
);
CREATE INDEX circular_maggot_output_idx
 ON circular_maggot_posting(farm_id,batch_id,output_id,created_at,id);

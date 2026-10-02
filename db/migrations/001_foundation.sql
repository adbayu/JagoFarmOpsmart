-- PostgreSQL 17+. Append-only migration; pg and PGlite both execute this SQL.
CREATE TYPE farming_type AS ENUM ('FISH', 'CHICKEN', 'CROP');
CREATE TYPE cycle_status AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE activity_status AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'CANCELLED');
CREATE TYPE activity_kind AS ENUM ('STOCKING', 'PLANTING', 'FEEDING', 'WATERING', 'FERTILIZING', 'MAINTENANCE', 'INSPECTION', 'TREATMENT', 'HARVESTING');
CREATE TYPE measure_unit AS ENUM ('KG', 'G', 'L', 'ML', 'UNIT', 'HEAD', 'SEED');
CREATE TYPE movement_type AS ENUM ('STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT', 'TRANSFER', 'CONSUMPTION', 'EXPIRED', 'DAMAGED', 'REVERSAL');
CREATE TYPE record_status AS ENUM ('POSTED', 'CANCELLED');
CREATE TYPE transaction_status AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');
CREATE TYPE payment_status AS ENUM ('UNPAID', 'PARTIAL', 'PAID');
CREATE TYPE product_status AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE inventory_category AS ENUM ('SEED', 'LIVESTOCK_SEED', 'FEED', 'FERTILIZER', 'NUTRIENT', 'MEDICINE', 'VITAMIN', 'EQUIPMENT', 'HARVEST_PRODUCT');

CREATE TABLE app_user (
 id uuid PRIMARY KEY, auth_subject text UNIQUE NOT NULL, display_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE farm (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES app_user(id), name text NOT NULL CHECK (length(trim(name)) > 0),
 location text, timezone text NOT NULL DEFAULT 'Asia/Jakarta', currency text NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX farm_owner_idx ON farm(owner_id);
CREATE TABLE commodity (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL REFERENCES farm(id), name text NOT NULL,
 farming_type farming_type NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (farm_id,id), UNIQUE (farm_id,id,farming_type), UNIQUE (farm_id,name,farming_type)
);
CREATE TABLE farm_unit (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL REFERENCES farm(id), name text NOT NULL, farming_type farming_type NOT NULL,
 location text, active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (farm_id,id), UNIQUE (farm_id,id,farming_type), UNIQUE (farm_id,name)
);
CREATE TABLE pond (
 unit_id uuid PRIMARY KEY, farm_id uuid NOT NULL, farming_type farming_type NOT NULL DEFAULT 'FISH' CHECK (farming_type='FISH'),
 area_m2 numeric(18,3) CHECK (area_m2>0), depth_m numeric(18,3) CHECK (depth_m>0), capacity_heads integer CHECK (capacity_heads>0), condition text,
 FOREIGN KEY (farm_id,unit_id,farming_type) REFERENCES farm_unit(farm_id,id,farming_type)
);
CREATE TABLE coop (
 unit_id uuid PRIMARY KEY, farm_id uuid NOT NULL, farming_type farming_type NOT NULL DEFAULT 'CHICKEN' CHECK (farming_type='CHICKEN'),
 area_m2 numeric(18,3) CHECK (area_m2>0), capacity_heads integer CHECK (capacity_heads>0),
 FOREIGN KEY (farm_id,unit_id,farming_type) REFERENCES farm_unit(farm_id,id,farming_type)
);
CREATE TABLE growing_area (
 unit_id uuid PRIMARY KEY, farm_id uuid NOT NULL, farming_type farming_type NOT NULL DEFAULT 'CROP' CHECK (farming_type='CROP'),
 area_m2 numeric(18,3) CHECK (area_m2>0), media text, capacity_plants integer CHECK (capacity_plants>0),
 FOREIGN KEY (farm_id,unit_id,farming_type) REFERENCES farm_unit(farm_id,id,farming_type)
);
CREATE TABLE farming_cycle (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL, unit_id uuid NOT NULL, commodity_id uuid NOT NULL,
 farming_type farming_type NOT NULL, name text NOT NULL, status cycle_status NOT NULL DEFAULT 'PLANNED',
 start_date date NOT NULL, target_harvest_date date, ended_at timestamptz, cancelled_at timestamptz, cancelled_by uuid REFERENCES app_user(id),
 created_by uuid NOT NULL REFERENCES app_user(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (farm_id,id), UNIQUE (farm_id,id,farming_type),
 FOREIGN KEY (farm_id,unit_id,farming_type) REFERENCES farm_unit(farm_id,id,farming_type),
 FOREIGN KEY (farm_id,commodity_id,farming_type) REFERENCES commodity(farm_id,id,farming_type),
 CHECK (target_harvest_date IS NULL OR target_harvest_date>=start_date)
);
CREATE INDEX cycle_unit_idx ON farming_cycle(farm_id,unit_id,status);
CREATE INDEX cycle_commodity_idx ON farming_cycle(farm_id,commodity_id,start_date);
CREATE TABLE fish_cycle (
 cycle_id uuid PRIMARY KEY, farm_id uuid NOT NULL, farming_type farming_type NOT NULL DEFAULT 'FISH' CHECK (farming_type='FISH'),
 initial_population integer NOT NULL CHECK (initial_population>0), seed_source text, initial_weight_g numeric(18,3) CHECK(initial_weight_g>0),
 FOREIGN KEY (farm_id,cycle_id,farming_type) REFERENCES farming_cycle(farm_id,id,farming_type)
);
CREATE TABLE chicken_cycle (
 cycle_id uuid PRIMARY KEY, farm_id uuid NOT NULL, farming_type farming_type NOT NULL DEFAULT 'CHICKEN' CHECK (farming_type='CHICKEN'),
 initial_population integer NOT NULL CHECK (initial_population>0), strain text, initial_age_days integer CHECK(initial_age_days>=0), seed_source text,
 FOREIGN KEY (farm_id,cycle_id,farming_type) REFERENCES farming_cycle(farm_id,id,farming_type)
);
CREATE TABLE crop_cycle (
 cycle_id uuid PRIMARY KEY, farm_id uuid NOT NULL, farming_type farming_type NOT NULL DEFAULT 'CROP' CHECK (farming_type='CROP'),
 seed_count integer NOT NULL CHECK(seed_count>0), variety text, seedling_date date,
 FOREIGN KEY (farm_id,cycle_id,farming_type) REFERENCES farming_cycle(farm_id,id,farming_type)
);
CREATE TABLE activity (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL, cycle_id uuid NOT NULL, kind activity_kind NOT NULL,
 status activity_status NOT NULL DEFAULT 'SCHEDULED', scheduled_at timestamptz NOT NULL, completed_at timestamptz,
 notes text, created_by uuid NOT NULL REFERENCES app_user(id), cancelled_at timestamptz, cancelled_by uuid REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(farm_id,id), UNIQUE(farm_id,id,cycle_id), FOREIGN KEY(farm_id,cycle_id) REFERENCES farming_cycle(farm_id,id)
);
CREATE INDEX activity_schedule_idx ON activity(farm_id,status,scheduled_at);
CREATE INDEX activity_cycle_idx ON activity(farm_id,cycle_id);
CREATE TABLE inventory_item (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL REFERENCES farm(id), name text NOT NULL, category inventory_category NOT NULL,
 unit measure_unit NOT NULL, minimum_stock numeric(18,3) NOT NULL DEFAULT 0 CHECK(minimum_stock>=0), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(farm_id,id), UNIQUE(farm_id,id,unit), UNIQUE(farm_id,name,unit)
);
CREATE TABLE product (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL, commodity_id uuid NOT NULL, inventory_item_id uuid NOT NULL,
 name text NOT NULL, grade text, unit measure_unit NOT NULL, status product_status NOT NULL DEFAULT 'ACTIVE',
 target_price_minor bigint CHECK(target_price_minor>=0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(farm_id,id), UNIQUE(farm_id,id,inventory_item_id), UNIQUE(farm_id,inventory_item_id),
 FOREIGN KEY(farm_id,commodity_id) REFERENCES commodity(farm_id,id),
 FOREIGN KEY(farm_id,inventory_item_id,unit) REFERENCES inventory_item(farm_id,id,unit)
);
CREATE TABLE harvest (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL, cycle_id uuid NOT NULL, harvest_date date NOT NULL,
 location text, notes text, status record_status NOT NULL DEFAULT 'POSTED',
 created_by uuid NOT NULL REFERENCES app_user(id), cancelled_at timestamptz, cancelled_by uuid REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(farm_id,id), FOREIGN KEY(farm_id,cycle_id) REFERENCES farming_cycle(farm_id,id)
);
CREATE INDEX harvest_cycle_date_idx ON harvest(farm_id,cycle_id,harvest_date);
CREATE TABLE harvest_output (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL, harvest_id uuid NOT NULL, product_id uuid NOT NULL, inventory_item_id uuid NOT NULL,
 quantity numeric(18,3) NOT NULL CHECK(quantity>0), weight_kg numeric(18,3) CHECK(weight_kg>0),
 UNIQUE(farm_id,id,inventory_item_id), UNIQUE(farm_id,id),
 FOREIGN KEY(farm_id,harvest_id) REFERENCES harvest(farm_id,id),
 FOREIGN KEY(farm_id,product_id,inventory_item_id) REFERENCES product(farm_id,id,inventory_item_id)
);
CREATE INDEX harvest_output_harvest_idx ON harvest_output(farm_id,harvest_id);
CREATE TABLE inventory_lot (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL, inventory_item_id uuid NOT NULL, harvest_output_id uuid,
 label text NOT NULL, location text, expires_on date, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(farm_id,id), UNIQUE(farm_id,id,inventory_item_id), UNIQUE(farm_id,harvest_output_id),
 FOREIGN KEY(farm_id,inventory_item_id) REFERENCES inventory_item(farm_id,id),
 FOREIGN KEY(farm_id,harvest_output_id,inventory_item_id) REFERENCES harvest_output(farm_id,id,inventory_item_id)
);
CREATE INDEX lot_item_idx ON inventory_lot(farm_id,inventory_item_id);
CREATE TABLE sale (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL REFERENCES farm(id), buyer text NOT NULL, sale_date date NOT NULL,
 status transaction_status NOT NULL DEFAULT 'DRAFT', payment_status payment_status NOT NULL DEFAULT 'UNPAID',
 total_minor bigint NOT NULL CHECK(total_minor>=0), created_by uuid NOT NULL REFERENCES app_user(id),
 cancelled_at timestamptz, cancelled_by uuid REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(farm_id,id)
);
CREATE INDEX sale_date_idx ON sale(farm_id,sale_date,status);
CREATE TABLE sale_item (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL, sale_id uuid NOT NULL, product_id uuid NOT NULL, inventory_item_id uuid NOT NULL,
 quantity numeric(18,3) NOT NULL CHECK(quantity>0), unit_price_minor bigint NOT NULL CHECK(unit_price_minor>=0),
 total_minor bigint NOT NULL CHECK(total_minor>=0), UNIQUE(farm_id,id), UNIQUE(farm_id,id,inventory_item_id),
 FOREIGN KEY(farm_id,sale_id) REFERENCES sale(farm_id,id),
 FOREIGN KEY(farm_id,product_id,inventory_item_id) REFERENCES product(farm_id,id,inventory_item_id)
);
CREATE INDEX sale_item_sale_idx ON sale_item(farm_id,sale_id);
CREATE INDEX sale_item_product_idx ON sale_item(farm_id,product_id);
CREATE TABLE consumption (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL, cycle_id uuid NOT NULL, activity_id uuid NOT NULL, inventory_item_id uuid NOT NULL,
 quantity numeric(18,3) NOT NULL CHECK(quantity>0), created_by uuid NOT NULL REFERENCES app_user(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(farm_id,id), UNIQUE(farm_id,id,inventory_item_id),
 FOREIGN KEY(farm_id,activity_id,cycle_id) REFERENCES activity(farm_id,id,cycle_id),
 FOREIGN KEY(farm_id,inventory_item_id) REFERENCES inventory_item(farm_id,id)
);
CREATE INDEX consumption_cycle_idx ON consumption(farm_id,cycle_id);
CREATE TABLE inventory_movement (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL, lot_id uuid NOT NULL, inventory_item_id uuid NOT NULL,
 type movement_type NOT NULL, quantity_delta numeric(18,3) NOT NULL CHECK(quantity_delta<>0), unit measure_unit NOT NULL,
 consumption_id uuid, sale_item_id uuid, reversal_of uuid, transfer_group uuid, reason text NOT NULL,
 created_by uuid NOT NULL REFERENCES app_user(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(farm_id,id), UNIQUE(farm_id,reversal_of),
 FOREIGN KEY(farm_id,lot_id,inventory_item_id) REFERENCES inventory_lot(farm_id,id,inventory_item_id),
 FOREIGN KEY(farm_id,inventory_item_id,unit) REFERENCES inventory_item(farm_id,id,unit),
 FOREIGN KEY(farm_id,consumption_id,inventory_item_id) REFERENCES consumption(farm_id,id,inventory_item_id),
 FOREIGN KEY(farm_id,sale_item_id,inventory_item_id) REFERENCES sale_item(farm_id,id,inventory_item_id),
 FOREIGN KEY(farm_id,reversal_of) REFERENCES inventory_movement(farm_id,id),
 CHECK ((unit NOT IN ('UNIT','HEAD','SEED')) OR quantity_delta=trunc(quantity_delta)),
 CHECK (type NOT IN ('STOCK_OUT','CONSUMPTION','EXPIRED','DAMAGED') OR quantity_delta<0),
 CHECK (type<>'STOCK_IN' OR quantity_delta>0),
 CHECK ((type='CONSUMPTION')=(consumption_id IS NOT NULL)),
 CHECK (sale_item_id IS NULL OR type='STOCK_OUT'),
 CHECK ((type='REVERSAL')=(reversal_of IS NOT NULL)),
 CHECK ((type='TRANSFER')=(transfer_group IS NOT NULL)),
 CHECK (num_nonnulls(consumption_id,sale_item_id,reversal_of)<=1)
);
CREATE INDEX movement_balance_idx ON inventory_movement(farm_id,lot_id);
CREATE INDEX movement_item_date_idx ON inventory_movement(farm_id,inventory_item_id,created_at);
CREATE INDEX movement_sale_idx ON inventory_movement(farm_id,sale_item_id);
CREATE INDEX movement_consumption_idx ON inventory_movement(farm_id,consumption_id);
CREATE TABLE cost_entry (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL REFERENCES farm(id), cycle_id uuid, activity_id uuid,
 inventory_movement_id uuid, source_key text NOT NULL, category text NOT NULL,
 treatment text NOT NULL CHECK(treatment IN ('UNCLASSIFIED','INVENTORY_PURCHASE','PRODUCTION','CAPITAL')),
 amount_minor bigint NOT NULL CHECK(amount_minor>=0), cost_date date NOT NULL, notes text,
 policy_version text, status record_status NOT NULL DEFAULT 'POSTED', created_by uuid NOT NULL REFERENCES app_user(id),
 cancelled_at timestamptz, cancelled_by uuid REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(farm_id,id), UNIQUE(farm_id,source_key), UNIQUE(farm_id,inventory_movement_id),
 FOREIGN KEY(farm_id,cycle_id) REFERENCES farming_cycle(farm_id,id),
 FOREIGN KEY(farm_id,activity_id,cycle_id) REFERENCES activity(farm_id,id,cycle_id),
 FOREIGN KEY(farm_id,inventory_movement_id) REFERENCES inventory_movement(farm_id,id),
 CHECK(activity_id IS NULL OR cycle_id IS NOT NULL),
 CHECK(treatment<>'PRODUCTION' OR (cycle_id IS NOT NULL AND policy_version IS NOT NULL))
);
CREATE INDEX cost_cycle_date_idx ON cost_entry(farm_id,cycle_id,cost_date);
CREATE TABLE command_receipt (
 farm_id uuid NOT NULL REFERENCES farm(id), operation text NOT NULL, idempotency_key uuid NOT NULL,
 request_hash text NOT NULL, response jsonb NOT NULL, created_by uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(farm_id,operation,idempotency_key)
);

-- A reversal is another movement. Neither original nor reversal is removed from sums.
CREATE VIEW stock_balance AS
 SELECT farm_id,inventory_item_id,lot_id,sum(quantity_delta) AS quantity
 FROM inventory_movement GROUP BY farm_id,inventory_item_id,lot_id;

CREATE FUNCTION protect_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Inventory movements are append-only' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER immutable_movement BEFORE UPDATE OR DELETE ON inventory_movement FOR EACH ROW EXECUTE FUNCTION protect_movement();

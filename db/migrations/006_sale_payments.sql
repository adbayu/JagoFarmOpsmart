CREATE TABLE sale_payment (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL, sale_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('PAYMENT','REFUND')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 payment_date date NOT NULL, source_key text NOT NULL,
 notes text, reason text, status record_status NOT NULL DEFAULT 'POSTED',
 CHECK(kind='PAYMENT' OR (reason IS NOT NULL AND length(trim(reason))>0)),
 created_by uuid NOT NULL REFERENCES app_user(id),
 cancelled_at timestamptz, cancelled_by uuid REFERENCES app_user(id),
 cancel_reason text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(farm_id,id), UNIQUE(farm_id,source_key),
 FOREIGN KEY(farm_id,sale_id) REFERENCES sale(farm_id,id)
);
CREATE INDEX sale_payment_sale_idx ON sale_payment(farm_id,sale_id,status);

ALTER TABLE cost_entry ADD COLUMN correction_of uuid;
ALTER TABLE cost_entry ADD COLUMN cancel_reason text;
ALTER TABLE cost_entry ADD CONSTRAINT cost_entry_correction_fk
  FOREIGN KEY(farm_id,correction_of) REFERENCES cost_entry(farm_id,id);
CREATE UNIQUE INDEX cost_entry_correction_once
  ON cost_entry(farm_id,correction_of) WHERE correction_of IS NOT NULL;
ALTER TABLE cost_entry DROP CONSTRAINT cost_entry_farm_id_inventory_movement_id_key;
CREATE UNIQUE INDEX cost_entry_posted_movement_once
  ON cost_entry(farm_id,inventory_movement_id)
  WHERE inventory_movement_id IS NOT NULL AND status='POSTED';

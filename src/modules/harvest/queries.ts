import type { Database, Sql } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import type { HarvestSummary } from "./contracts.js";

type Row = {
  id: string;
  cycle_id: string;
  cycle_name: string;
  harvest_date: string;
  location: string | null;
  notes: string | null;
  status: HarvestSummary["status"];
  output_id: string;
  product_id: string;
  product_name: string;
  grade: string | null;
  lot_id: string;
  lot_label: string;
  quantity: string;
  unit: string;
  weight_kg: string | null;
  balance: string;
};
const selectHarvest = `SELECT h.id,h.cycle_id,c.name AS cycle_name,h.harvest_date::text AS harvest_date,
 h.location,h.notes,h.status,o.id AS output_id,o.product_id,p.name AS product_name,p.grade,
 l.id AS lot_id,l.label AS lot_label,o.quantity::text AS quantity,p.unit,
 o.weight_kg::text AS weight_kg,COALESCE(b.quantity,0)::text AS balance
 FROM harvest h JOIN farming_cycle c ON c.farm_id=h.farm_id AND c.id=h.cycle_id
 JOIN harvest_output o ON o.farm_id=h.farm_id AND o.harvest_id=h.id
 JOIN product p ON p.farm_id=o.farm_id AND p.id=o.product_id
 JOIN inventory_lot l ON l.farm_id=o.farm_id AND l.harvest_output_id=o.id
 LEFT JOIN (SELECT farm_id,lot_id,sum(quantity_delta) AS quantity
   FROM inventory_movement GROUP BY farm_id,lot_id) b ON b.farm_id=l.farm_id AND b.lot_id=l.id`;
function summaries(rows: Row[]): HarvestSummary[] {
  const byId = new Map<string, HarvestSummary>();
  for (const row of rows) {
    let entry = byId.get(row.id);
    if (!entry) {
      entry = {
        id: row.id,
        cycleId: row.cycle_id,
        cycleName: row.cycle_name,
        harvestDate: row.harvest_date,
        location: row.location,
        notes: row.notes,
        status: row.status,
        outputs: [],
      };
      byId.set(row.id, entry);
    }
    entry.outputs.push({
      id: row.output_id,
      productId: row.product_id,
      productName: row.product_name,
      grade: row.grade,
      lotId: row.lot_id,
      lotLabel: row.lot_label,
      quantity: row.quantity,
      unit: row.unit,
      weightKg: row.weight_kg,
      balance: row.balance,
    });
  }
  return [...byId.values()];
}
async function assertOwner(tx: Sql, actorId: string, farmId: string) {
  const result = await tx.query<{ id: string }>(
    "SELECT f.id FROM farm f JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2 WHERE f.id=$1 AND f.archived_at IS NULL",
    [farmId, actorId],
  );
  if (!result.rows[0]) throw new DomainError("FORBIDDEN");
}
export async function listHarvests(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<HarvestSummary[]> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  return db.transaction(async (tx) => {
    await assertOwner(tx, actorId, farmId);
    const result = await tx.query<Row>(
      `${selectHarvest} WHERE h.farm_id=$1 ORDER BY h.harvest_date DESC,h.id DESC,o.id`,
      [farmId],
    );
    return summaries(result.rows);
  });
}
export async function getHarvest(
  db: Database,
  actorId: string,
  farmId: string,
  harvestId: string,
): Promise<HarvestSummary> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(harvestId);
  return db.transaction(async (tx) => {
    await assertOwner(tx, actorId, farmId);
    const result = await tx.query<Row>(
      `${selectHarvest} WHERE h.farm_id=$1 AND h.id=$2 ORDER BY o.id`,
      [farmId, harvestId],
    );
    const harvest = summaries(result.rows)[0];
    if (!harvest) throw new DomainError("NOT_FOUND");
    return harvest;
  });
}

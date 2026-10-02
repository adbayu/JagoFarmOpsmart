import type { Database, Sql } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import type { SaleLotOption, SaleSummary } from "./contracts.js";

async function assertOwner(tx: Sql, actorId: string, farmId: string) {
  const result = await tx.query<{ id: string }>(
    "SELECT f.id FROM farm f JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2 WHERE f.id=$1 AND f.archived_at IS NULL",
    [farmId, actorId],
  );
  if (!result.rows[0]) throw new DomainError("FORBIDDEN");
}
type LotRow = {
  lot_id: string;
  lot_label: string;
  product_id: string;
  product_name: string;
  unit: string;
  balance: string;
  harvest_id: string;
  cycle_id: string;
  cycle_name: string;
};
export async function listSaleLotOptions(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<SaleLotOption[]> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  return db.transaction(async (tx) => {
    await assertOwner(tx, actorId, farmId);
    const result = await tx.query<LotRow>(
      `SELECT l.id AS lot_id,l.label AS lot_label,p.id AS product_id,p.name AS product_name,p.unit,
       sum(m.quantity_delta)::text AS balance,h.id AS harvest_id,c.id AS cycle_id,c.name AS cycle_name
       FROM inventory_lot l JOIN harvest_output o ON o.farm_id=l.farm_id AND o.id=l.harvest_output_id
       JOIN harvest h ON h.farm_id=o.farm_id AND h.id=o.harvest_id AND h.status='POSTED'
       JOIN farming_cycle c ON c.farm_id=h.farm_id AND c.id=h.cycle_id
       JOIN product p ON p.farm_id=o.farm_id AND p.id=o.product_id AND p.status='ACTIVE'
       JOIN inventory_item i ON i.farm_id=l.farm_id AND i.id=l.inventory_item_id AND i.active=true
       JOIN inventory_movement m ON m.farm_id=l.farm_id AND m.lot_id=l.id
       WHERE l.farm_id=$1 AND (l.expires_on IS NULL OR l.expires_on>=CURRENT_DATE)
       GROUP BY l.id,l.label,p.id,p.name,p.unit,h.id,c.id,c.name
       HAVING sum(m.quantity_delta)>0 ORDER BY p.name,h.harvest_date,l.label,l.id`,
      [farmId],
    );
    return result.rows.map((row) => ({
      lotId: row.lot_id,
      lotLabel: row.lot_label,
      productId: row.product_id,
      productName: row.product_name,
      unit: row.unit,
      balance: row.balance,
      harvestId: row.harvest_id,
      cycleId: row.cycle_id,
      cycleName: row.cycle_name,
    }));
  });
}
type SaleRow = {
  id: string;
  buyer: string;
  sale_date: string;
  status: SaleSummary["status"];
  total_minor: string;
  item_id: string;
  product_id: string;
  product_name: string;
  quantity: string;
  unit: string;
  unit_price_minor: string;
  item_total_minor: string;
  movement_id: string;
  lot_id: string;
  lot_label: string;
  allocation_quantity: string;
  harvest_id: string;
  cycle_id: string;
  cycle_name: string;
};
const selectSale = `SELECT s.id,s.buyer,s.sale_date::text AS sale_date,s.status,s.total_minor::text AS total_minor,
 si.id AS item_id,si.product_id,p.name AS product_name,si.quantity::text AS quantity,p.unit,
 si.unit_price_minor::text AS unit_price_minor,si.total_minor::text AS item_total_minor,
 m.id AS movement_id,l.id AS lot_id,l.label AS lot_label,(-m.quantity_delta)::text AS allocation_quantity,
 h.id AS harvest_id,c.id AS cycle_id,c.name AS cycle_name
 FROM sale s JOIN sale_item si ON si.farm_id=s.farm_id AND si.sale_id=s.id
 JOIN product p ON p.farm_id=si.farm_id AND p.id=si.product_id
 JOIN inventory_movement m ON m.farm_id=si.farm_id AND m.sale_item_id=si.id
 JOIN inventory_lot l ON l.farm_id=m.farm_id AND l.id=m.lot_id
 JOIN harvest_output o ON o.farm_id=l.farm_id AND o.id=l.harvest_output_id
 JOIN harvest h ON h.farm_id=o.farm_id AND h.id=o.harvest_id
 JOIN farming_cycle c ON c.farm_id=h.farm_id AND c.id=h.cycle_id`;
function summaries(rows: SaleRow[]): SaleSummary[] {
  const sales = new Map<string, SaleSummary>();
  for (const row of rows) {
    let sale = sales.get(row.id);
    if (!sale) {
      sale = {
        id: row.id,
        buyer: row.buyer,
        saleDate: row.sale_date,
        status: row.status,
        totalMinor: row.total_minor,
        items: [],
      };
      sales.set(row.id, sale);
    }
    let item = sale.items.find((value) => value.id === row.item_id);
    if (!item) {
      item = {
        id: row.item_id,
        productId: row.product_id,
        productName: row.product_name,
        quantity: row.quantity,
        unit: row.unit,
        unitPriceMinor: row.unit_price_minor,
        totalMinor: row.item_total_minor,
        allocations: [],
      };
      sale.items.push(item);
    }
    item.allocations.push({
      movementId: row.movement_id,
      lotId: row.lot_id,
      lotLabel: row.lot_label,
      quantity: row.allocation_quantity,
      harvestId: row.harvest_id,
      cycleId: row.cycle_id,
      cycleName: row.cycle_name,
    });
  }
  return [...sales.values()];
}
export async function listSales(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<SaleSummary[]> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  return db.transaction(async (tx) => {
    await assertOwner(tx, actorId, farmId);
    const result = await tx.query<SaleRow>(
      `${selectSale} WHERE s.farm_id=$1 ORDER BY s.sale_date DESC,s.id DESC,si.id,m.id`,
      [farmId],
    );
    return summaries(result.rows);
  });
}
export async function getSale(
  db: Database,
  actorId: string,
  farmId: string,
  saleId: string,
): Promise<SaleSummary> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(saleId);
  return db.transaction(async (tx) => {
    await assertOwner(tx, actorId, farmId);
    const result = await tx.query<SaleRow>(
      `${selectSale} WHERE s.farm_id=$1 AND s.id=$2 ORDER BY si.id,m.id`,
      [farmId, saleId],
    );
    const sale = summaries(result.rows)[0];
    if (!sale) throw new DomainError("NOT_FOUND");
    return sale;
  });
}

import type { Database } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { dateOnly, uuid } from "../../shared/validation.js";
import type { ProductionAnalytics } from "./contracts.js";
import { getFarmFinanceProjection } from "../finance/projection-queries.js";

export async function getProductionAnalytics(
  db: Database,
  actorId: string,
  farmId: string,
  from: string,
  toExclusive: string,
  cycleId?: string,
): Promise<ProductionAnalytics> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  dateOnly.parse(from);
  dateOnly.parse(toExclusive);
  if (cycleId) uuid.parse(cycleId);
  if (from >= toExclusive) throw new DomainError("VALIDATION");
  return db.transaction(async (tx) => {
    const owner = await tx.query<{ id: string }>(
      "SELECT f.id FROM farm f JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2 WHERE f.id=$1 AND f.archived_at IS NULL",
      [farmId, actorId],
    );
    if (!owner.rows[0]) throw new DomainError("FORBIDDEN");
    if (cycleId) {
      const cycle = await tx.query<{ id: string }>(
        "SELECT id FROM farming_cycle WHERE farm_id=$1 AND id=$2",
        [farmId, cycleId],
      );
      if (!cycle.rows[0]) throw new DomainError("NOT_FOUND");
    }
    const result = await tx.query<{
      cycle_id: string;
      cycle_name: string;
      commodity_id: string;
      commodity_name: string;
      farming_type: string;
      unit: ProductionAnalytics["rows"][number]["unit"];
      quantity: string;
      harvest_count: string;
    }>(
      `SELECT c.id AS cycle_id,c.name AS cycle_name,co.id AS commodity_id,co.name AS commodity_name,
       c.farming_type,p.unit,sum(o.quantity)::text AS quantity,count(DISTINCT h.id)::text AS harvest_count
       FROM harvest_output o JOIN harvest h ON h.farm_id=o.farm_id AND h.id=o.harvest_id AND h.status='POSTED'
       JOIN farming_cycle c ON c.farm_id=h.farm_id AND c.id=h.cycle_id
       JOIN commodity co ON co.farm_id=c.farm_id AND co.id=c.commodity_id
       JOIN product p ON p.farm_id=o.farm_id AND p.id=o.product_id
       WHERE o.farm_id=$1 AND h.harvest_date >= $2::date AND h.harvest_date < $3::date
       AND ($4::uuid IS NULL OR c.id=$4)
       GROUP BY c.id,c.name,co.id,co.name,c.farming_type,p.unit
       ORDER BY co.name,c.name,p.unit,c.id`,
      [farmId, from, toExclusive, cycleId ?? null],
    );
    const finances = await getFarmFinanceProjection(
      tx,
      farmId,
      from,
      toExclusive,
    );
    return {
      from,
      toExclusive,
      asOf: new Date().toISOString(),
      rows: result.rows.map((row) => ({
        cycleId: row.cycle_id,
        cycleName: row.cycle_name,
        commodityId: row.commodity_id,
        commodityName: row.commodity_name,
        farmingType: row.farming_type,
        unit: row.unit,
        quantity: row.quantity,
        harvestCount: Number(row.harvest_count),
      })),
      survival: {
        status: "UNAVAILABLE",
        reason:
          "Populasi akhir dan kehilangan lengkap belum dipastikan untuk panen parsial.",
      },
      growth: {
        status: "UNAVAILABLE",
        reason: "Pengukuran bobot awal dan akhir yang sebanding belum lengkap.",
      },
      feedEfficiency: {
        status: "UNAVAILABLE",
        reason:
          "Konsumsi pakan dan pertambahan biomassa yang sebanding belum lengkap.",
      },
      revenue: finances.revenue,
      hpp: finances.hpp,
      profit: finances.profit,
      financeSources: {
        paymentIds: finances.sourcePaymentIds,
        hppPaymentIds: finances.hppSourcePaymentIds,
        refundIds: finances.sourceRefundIds,
        saleIds: finances.sourceSaleIds,
        costIds: finances.sourceCostIds,
        harvestIds: finances.sourceHarvestIds,
        movementIds: finances.sourceMovementIds,
      },
    };
  });
}

import type { Database } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { dateOnly, uuid } from "../../shared/validation.js";
import type { FarmingType, Unit } from "../../shared/domain.js";
import type { CycleComparison } from "./contracts.js";

export async function getCycleComparison(
  db: Database,
  actorId: string,
  farmId: string,
  cycleIdA: string,
  cycleIdB: string,
  from: string,
  toExclusive: string,
): Promise<CycleComparison> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(cycleIdA);
  uuid.parse(cycleIdB);
  dateOnly.parse(from);
  dateOnly.parse(toExclusive);
  if (cycleIdA === cycleIdB || from >= toExclusive)
    throw new DomainError("VALIDATION");

  return db.transaction(async (tx) => {
    const membership = await tx.query<{ id: string }>(
      `SELECT f.id FROM farm f
       JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2
       WHERE f.id=$1 AND f.archived_at IS NULL`,
      [farmId, actorId],
    );
    if (!membership.rows[0]) throw new DomainError("FORBIDDEN");

    const cycles = await tx.query<{
      id: string;
      name: string;
      farming_type: FarmingType;
      status: CycleComparison["cycles"][number]["status"];
      start_date: string;
      commodity_id: string;
      commodity_name: string;
    }>(
      `SELECT c.id,c.name,c.farming_type,c.status,c.start_date::text AS start_date,
         co.id AS commodity_id,co.name AS commodity_name
       FROM farming_cycle c
       JOIN commodity co ON co.farm_id=c.farm_id AND co.id=c.commodity_id
       WHERE c.farm_id=$1 AND c.id IN ($2,$3)`,
      [farmId, cycleIdA, cycleIdB],
    );
    if (cycles.rows.length !== 2) throw new DomainError("NOT_FOUND");

    const production = await tx.query<{
      cycle_id: string;
      commodity_id: string;
      commodity_name: string;
      unit: Unit;
      quantity: string;
      harvest_count: string;
      harvest_ids: string[];
    }>(
      `SELECT h.cycle_id,co.id AS commodity_id,co.name AS commodity_name,p.unit,
         sum(o.quantity)::text AS quantity,count(DISTINCT h.id)::text AS harvest_count,
         array_agg(DISTINCT h.id ORDER BY h.id)::text[] AS harvest_ids
       FROM harvest_output o
       JOIN harvest h ON h.farm_id=o.farm_id AND h.id=o.harvest_id AND h.status='POSTED'
       JOIN farming_cycle c ON c.farm_id=h.farm_id AND c.id=h.cycle_id
       JOIN commodity co ON co.farm_id=c.farm_id AND co.id=c.commodity_id
       JOIN product p ON p.farm_id=o.farm_id AND p.id=o.product_id
       WHERE o.farm_id=$1 AND h.cycle_id IN ($2,$3)
         AND h.harvest_date >= $4::date AND h.harvest_date < $5::date
       GROUP BY h.cycle_id,co.id,co.name,p.unit
       ORDER BY h.cycle_id,co.name,p.unit,co.id`,
      [farmId, cycleIdA, cycleIdB, from, toExclusive],
    );
    const costs = await tx.query<{
      cycle_id: string;
      category: string;
      treatment: string;
      amount_minor: string;
      entry_count: string;
      cost_ids: string[];
    }>(
      `SELECT cycle_id,category,treatment,sum(amount_minor)::text AS amount_minor,
         count(*)::text AS entry_count,array_agg(id ORDER BY id)::text[] AS cost_ids
       FROM cost_entry
       WHERE farm_id=$1 AND cycle_id IN ($2,$3) AND status='POSTED'
         AND cost_date >= $4::date AND cost_date < $5::date
       GROUP BY cycle_id,category,treatment
       ORDER BY cycle_id,category,treatment`,
      [farmId, cycleIdA, cycleIdB, from, toExclusive],
    );

    return {
      from,
      toExclusive,
      asOf: new Date().toISOString(),
      cycles: [cycleIdA, cycleIdB].map((cycleId) => {
        const cycle = cycles.rows.find((row) => row.id === cycleId)!;
        return {
          cycleId: cycle.id,
          name: cycle.name,
          farmingType: cycle.farming_type,
          status: cycle.status,
          startDate: cycle.start_date,
          commodityId: cycle.commodity_id,
          commodityName: cycle.commodity_name,
          production: production.rows
            .filter((row) => row.cycle_id === cycleId)
            .map((row) => ({
              commodityId: row.commodity_id,
              commodityName: row.commodity_name,
              unit: row.unit,
              quantity: row.quantity,
              harvestCount: Number(row.harvest_count),
              harvestIds: row.harvest_ids,
            })),
          costs: costs.rows
            .filter((row) => row.cycle_id === cycleId)
            .map((row) => ({
              category: row.category,
              treatment: row.treatment,
              amountMinor: row.amount_minor,
              entryCount: Number(row.entry_count),
              costIds: row.cost_ids,
            })),
        };
      }),
    };
  });
}

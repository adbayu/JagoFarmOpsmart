import type { Database } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { dateOnly, uuid } from "../../shared/validation.js";
import type { Unit } from "../../shared/domain.js";
import type { AdvancedAnalytics } from "./contracts.js";

export async function getAdvancedAnalytics(
  db: Database,
  actorId: string,
  farmId: string,
  from: string,
  toExclusive: string,
): Promise<AdvancedAnalytics> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  dateOnly.parse(from);
  dateOnly.parse(toExclusive);
  if (from >= toExclusive) throw new DomainError("VALIDATION");

  return db.transaction(async (tx) => {
    const farm = await tx.query<{ id: string }>(
      "SELECT f.id FROM farm f JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2 WHERE f.id=$1 AND f.archived_at IS NULL",
      [farmId, actorId],
    );
    if (!farm.rows[0]) throw new DomainError("FORBIDDEN");

    const production = await tx.query<{
      period: string;
      commodity_id: string;
      commodity_name: string;
      unit: Unit;
      quantity: string;
      harvest_count: string;
      harvest_ids: string[];
    }>(
      `SELECT to_char(date_trunc('month',h.harvest_date)::date,'YYYY-MM-DD') AS period,
         co.id AS commodity_id,co.name AS commodity_name,p.unit,
         sum(o.quantity)::text AS quantity,count(DISTINCT h.id)::text AS harvest_count,
         array_agg(DISTINCT h.id ORDER BY h.id)::text[] AS harvest_ids
       FROM harvest_output o
       JOIN harvest h ON h.farm_id=o.farm_id AND h.id=o.harvest_id AND h.status='POSTED'
       JOIN farming_cycle c ON c.farm_id=h.farm_id AND c.id=h.cycle_id
       JOIN commodity co ON co.farm_id=c.farm_id AND co.id=c.commodity_id
       JOIN product p ON p.farm_id=o.farm_id AND p.id=o.product_id
       WHERE o.farm_id=$1 AND h.harvest_date >= $2::date AND h.harvest_date < $3::date
       GROUP BY date_trunc('month',h.harvest_date)::date,co.id,co.name,p.unit
       ORDER BY period,co.name,p.unit,co.id`,
      [farmId, from, toExclusive],
    );
    const costs = await tx.query<{
      category: string;
      treatment: string;
      amount_minor: string;
      entry_count: string;
      cost_ids: string[];
    }>(
      `SELECT category,treatment,sum(amount_minor)::text AS amount_minor,
         count(*)::text AS entry_count,array_agg(id ORDER BY id)::text[] AS cost_ids
       FROM cost_entry
       WHERE farm_id=$1 AND status='POSTED' AND cost_date >= $2::date AND cost_date < $3::date
       GROUP BY category,treatment
       ORDER BY category,treatment`,
      [farmId, from, toExclusive],
    );
    const waterTransfers = await tx.query<{
      period: string;
      source_unit_id: string;
      source_unit_name: string;
      target_unit_id: string;
      target_unit_name: string;
      quantity_liters: string;
      transfer_count: string;
      transfer_ids: string[];
    }>(
      `SELECT to_char(date_trunc('month',t.transfer_date)::date,'YYYY-MM-DD') AS period,
         t.source_unit_id,s.name AS source_unit_name,
         t.target_unit_id,d.name AS target_unit_name,
         sum(t.quantity_liters)::text AS quantity_liters,
         count(*)::text AS transfer_count,
         array_agg(t.id ORDER BY t.id)::text[] AS transfer_ids
       FROM circular_water_transfer t
       JOIN farm_unit s ON s.farm_id=t.farm_id AND s.id=t.source_unit_id
       JOIN farm_unit d ON d.farm_id=t.farm_id AND d.id=t.target_unit_id
       WHERE t.farm_id=$1 AND t.transfer_date >= $2::date AND t.transfer_date < $3::date
       GROUP BY date_trunc('month',t.transfer_date)::date,
         t.source_unit_id,s.name,t.target_unit_id,d.name
       ORDER BY period,s.name,d.name,t.source_unit_id,t.target_unit_id`,
      [farmId, from, toExclusive],
    );
    const maggotWasteInputs = await tx.query<{
      period: string;
      unit: Unit;
      quantity: string;
      input_count: string;
      input_ids: string[];
      waste_ids: string[];
      batch_ids: string[];
    }>(
      `SELECT to_char(date_trunc('month',i.created_at AT TIME ZONE 'UTC')::date,'YYYY-MM-DD') AS period,
         i.unit,sum(i.quantity)::text AS quantity,count(*)::text AS input_count,
         array_agg(i.id ORDER BY i.id)::text[] AS input_ids,
         array_agg(DISTINCT i.waste_id ORDER BY i.waste_id)::text[] AS waste_ids,
         array_agg(DISTINCT i.batch_id ORDER BY i.batch_id)::text[] AS batch_ids
       FROM maggot_batch_input i
       WHERE i.farm_id=$1
         AND i.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
         AND i.created_at < ($3::date::timestamp AT TIME ZONE 'UTC')
       GROUP BY date_trunc('month',i.created_at AT TIME ZONE 'UTC'),i.unit
       ORDER BY period,i.unit::text`,
      [farmId, from, toExclusive],
    );
    const maggotOutputs = await tx.query<{
      period: string;
      unit: Unit;
      quantity: string;
      output_count: string;
      output_ids: string[];
      batch_ids: string[];
    }>(
      `SELECT to_char(date_trunc('month',o.harvested_at AT TIME ZONE 'UTC')::date,'YYYY-MM-DD') AS period,
         o.unit,sum(o.quantity)::text AS quantity,count(*)::text AS output_count,
         array_agg(o.id ORDER BY o.id)::text[] AS output_ids,
         array_agg(DISTINCT o.batch_id ORDER BY o.batch_id)::text[] AS batch_ids
       FROM maggot_batch_output o
       WHERE o.farm_id=$1
         AND o.harvested_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
         AND o.harvested_at < ($3::date::timestamp AT TIME ZONE 'UTC')
       GROUP BY date_trunc('month',o.harvested_at AT TIME ZONE 'UTC'),o.unit
       ORDER BY period,o.unit::text`,
      [farmId, from, toExclusive],
    );

    return {
      from,
      toExclusive,
      asOf: new Date().toISOString(),
      productionTrend: production.rows.map((row) => ({
        period: row.period,
        commodityId: row.commodity_id,
        commodityName: row.commodity_name,
        unit: row.unit,
        quantity: row.quantity,
        harvestCount: Number(row.harvest_count),
        harvestIds: row.harvest_ids,
      })),
      recordedCostBreakdown: costs.rows.map((row) => ({
        category: row.category,
        treatment: row.treatment,
        amountMinor: row.amount_minor,
        entryCount: Number(row.entry_count),
        costIds: row.cost_ids,
      })),
      recordedWaterTransfers: waterTransfers.rows.map((row) => ({
        period: row.period,
        sourceUnitId: row.source_unit_id,
        sourceUnitName: row.source_unit_name,
        targetUnitId: row.target_unit_id,
        targetUnitName: row.target_unit_name,
        quantityLiters: row.quantity_liters,
        transferCount: Number(row.transfer_count),
        transferIds: row.transfer_ids,
      })),
      maggotWasteInputs: maggotWasteInputs.rows.map((row) => ({
        period: row.period,
        unit: row.unit,
        quantity: row.quantity,
        inputCount: Number(row.input_count),
        inputIds: row.input_ids,
        wasteIds: row.waste_ids,
        batchIds: row.batch_ids,
      })),
      maggotOutputs: maggotOutputs.rows.map((row) => ({
        period: row.period,
        unit: row.unit,
        quantity: row.quantity,
        outputCount: Number(row.output_count),
        outputIds: row.output_ids,
        batchIds: row.batch_ids,
      })),
    };
  });
}

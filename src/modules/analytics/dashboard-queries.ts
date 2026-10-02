import type { Database } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import type { DashboardSummary } from "./contracts.js";
import { getFarmFinanceProjection } from "../finance/projection-queries.js";

type ActivityRow = {
  id: string;
  kind: string;
  status: string;
  scheduled_at: string;
  cycle_name: string;
};
export async function getDashboard(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<DashboardSummary> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  return db.transaction(async (tx) => {
    const owner = await tx.query<{ id: string }>(
      "SELECT f.id FROM farm f JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2 WHERE f.id=$1 AND f.archived_at IS NULL",
      [farmId, actorId],
    );
    if (!owner.rows[0]) throw new DomainError("FORBIDDEN");
    const units = await tx.query<{
      farming_type: "FISH" | "CHICKEN" | "CROP";
      count: string;
    }>(
      "SELECT farming_type,count(*)::text AS count FROM farm_unit WHERE farm_id=$1 AND active=true GROUP BY farming_type",
      [farmId],
    );
    const cycles = await tx.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM farming_cycle WHERE farm_id=$1 AND status='ACTIVE'",
      [farmId],
    );
    const upcoming = await tx.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM activity WHERE farm_id=$1 AND status IN ('SCHEDULED','IN_PROGRESS') AND scheduled_at>=now() AND scheduled_at<now()+interval '14 days'",
      [farmId],
    );
    const today = await tx.query<ActivityRow>(
      `SELECT a.id,a.kind,a.status,a.scheduled_at::text AS scheduled_at,c.name AS cycle_name
       FROM activity a JOIN farming_cycle c ON c.farm_id=a.farm_id AND c.id=a.cycle_id
       JOIN farm f ON f.id=a.farm_id WHERE a.farm_id=$1
       AND (a.scheduled_at AT TIME ZONE f.timezone)::date=(now() AT TIME ZONE f.timezone)::date
       AND a.status<>'CANCELLED' ORDER BY a.scheduled_at,a.id LIMIT 5`,
      [farmId],
    );
    const recent = await tx.query<ActivityRow>(
      `SELECT a.id,a.kind,a.status,a.scheduled_at::text AS scheduled_at,c.name AS cycle_name
       FROM activity a JOIN farming_cycle c ON c.farm_id=a.farm_id AND c.id=a.cycle_id
       WHERE a.farm_id=$1 AND a.status IN ('COMPLETED','IN_PROGRESS')
       ORDER BY a.updated_at DESC,a.id DESC LIMIT 5`,
      [farmId],
    );
    const production = await tx.query<{
      commodity_id: string;
      commodity_name: string;
      unit: DashboardSummary["production"][number]["unit"];
      quantity: string;
    }>(
      `SELECT c.commodity_id,co.name AS commodity_name,p.unit,sum(o.quantity)::text AS quantity FROM harvest_output o
       JOIN harvest h ON h.farm_id=o.farm_id AND h.id=o.harvest_id AND h.status='POSTED'
       JOIN farming_cycle c ON c.farm_id=h.farm_id AND c.id=h.cycle_id
       JOIN commodity co ON co.farm_id=c.farm_id AND co.id=c.commodity_id
       JOIN product p ON p.farm_id=o.farm_id AND p.id=o.product_id
       WHERE o.farm_id=$1 GROUP BY c.commodity_id,co.name,p.unit ORDER BY co.name,p.unit`,
      [farmId],
    );
    const costs = await tx.query<{ total: string; monthly: string }>(
      `SELECT COALESCE(sum(amount_minor),0)::text AS total,
       COALESCE(sum(amount_minor) FILTER (WHERE cost_date>=date_trunc('month',now())::date
       AND cost_date<(date_trunc('month',now())+interval '1 month')::date),0)::text AS monthly
       FROM cost_entry WHERE farm_id=$1 AND status='POSTED'`,
      [farmId],
    );
    const sales = await tx.query<{ total: string }>(
      "SELECT COALESCE(sum(total_minor),0)::text AS total FROM sale WHERE farm_id=$1 AND status='COMPLETED'",
      [farmId],
    );
    const finances = await getFarmFinanceProjection(tx, farmId);
    const activeUnits = { FISH: 0, CHICKEN: 0, CROP: 0 };
    for (const row of units.rows)
      activeUnits[row.farming_type] = Number(row.count);
    const activity = (row: ActivityRow) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      scheduledAt: row.scheduled_at,
      cycleName: row.cycle_name,
    });
    return {
      activeUnits,
      activeCycles: Number(cycles.rows[0]?.count ?? 0),
      upcomingActivityCount: Number(upcoming.rows[0]?.count ?? 0),
      todayActivities: today.rows.map(activity),
      recentActivities: recent.rows.map(activity),
      production: production.rows.map((row) => ({
        commodityId: row.commodity_id,
        commodityName: row.commodity_name,
        unit: row.unit,
        quantity: row.quantity,
      })),
      finance: {
        recordedCosts: costs.rows[0]?.total ?? "0",
        completedSalesValue: sales.rows[0]?.total ?? "0",
        revenue: finances.revenue,
        hpp: finances.hpp,
        profit: finances.profit,
        sources: {
          paymentIds: finances.sourcePaymentIds,
          hppPaymentIds: finances.hppSourcePaymentIds,
          refundIds: finances.sourceRefundIds,
          saleIds: finances.sourceSaleIds,
          costIds: finances.sourceCostIds,
          harvestIds: finances.sourceHarvestIds,
          movementIds: finances.sourceMovementIds,
        },
      },
      monthlyRecordedCosts: costs.rows[0]?.monthly ?? "0",
      asOf: new Date().toISOString(),
    };
  });
}

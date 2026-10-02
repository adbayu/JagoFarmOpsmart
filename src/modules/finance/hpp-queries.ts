import type { Database, Sql } from "../../server/db.js";
import { command } from "../../server/command.js";
import type { CommandContext } from "../../shared/domain.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import { calculateHpp } from "./calculator.js";
import {
  completeCycleCostsInput,
  type CycleHppProjection,
} from "./contracts.js";
import { financePolicyVersion } from "./policy.js";

async function assertFarmOwner(tx: Sql, actorId: string, farmId: string) {
  const farm = await tx.query<{ id: string }>(
    "SELECT f.id FROM farm f JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2 WHERE f.id=$1 AND f.archived_at IS NULL",
    [farmId, actorId],
  );
  if (!farm.rows[0]) throw new DomainError("FORBIDDEN");
}

export async function getCycleHppInTransaction(
  tx: Sql,
  farmId: string,
  cycleId: string,
): Promise<CycleHppProjection> {
  uuid.parse(farmId);
  uuid.parse(cycleId);
  const cycleResult = await tx.query<{ id: string; name: string }>(
    "SELECT id,name FROM farming_cycle WHERE farm_id=$1 AND id=$2",
    [farmId, cycleId],
  );
  const cycle = cycleResult.rows[0];
  if (!cycle) throw new DomainError("NOT_FOUND");

  const harvests = await tx.query<{
    weight_kg: string;
    has_missing_weight: boolean;
    harvest_ids: string[] | null;
  }>(
    `SELECT COALESCE(sum(o.weight_kg),0)::text AS weight_kg,
       COALESCE(bool_or(o.weight_kg IS NULL),false) AS has_missing_weight,
       COALESCE(array_agg(DISTINCT h.id ORDER BY h.id),ARRAY[]::uuid[])::text[] AS harvest_ids
       FROM harvest_output o JOIN harvest h ON h.farm_id=o.farm_id AND h.id=o.harvest_id
       WHERE o.farm_id=$1 AND h.cycle_id=$2 AND h.status='POSTED'`,
    [farmId, cycleId],
  );
  const costs = await tx.query<{
    total_minor: string;
    cost_ids: string[] | null;
    has_unclassified: boolean;
  }>(
    `SELECT COALESCE(sum(amount_minor) FILTER (WHERE treatment='PRODUCTION'),0)::text AS total_minor,
       COALESCE(array_agg(id ORDER BY id) FILTER (WHERE treatment='PRODUCTION'),ARRAY[]::uuid[])::text[] AS cost_ids,
       COALESCE(bool_or(treatment='UNCLASSIFIED'),false) AS has_unclassified
       FROM cost_entry WHERE farm_id=$1 AND status='POSTED'
       AND (cycle_id=$2 OR (cycle_id IS NULL AND treatment='UNCLASSIFIED'))
       AND (treatment<>'PRODUCTION' OR inventory_movement_id IS NULL OR EXISTS(
         SELECT 1 FROM inventory_movement m WHERE m.farm_id=cost_entry.farm_id
         AND m.id=cost_entry.inventory_movement_id AND m.type='CONSUMPTION'
         AND NOT EXISTS(SELECT 1 FROM inventory_movement r WHERE r.farm_id=m.farm_id AND r.reversal_of=m.id)
       ))`,
    [farmId, cycleId],
  );
  const consumption = await tx.query<{ missing: string }>(
    `SELECT count(*)::text AS missing FROM consumption c
       JOIN inventory_movement m ON m.farm_id=c.farm_id AND m.consumption_id=c.id AND m.type='CONSUMPTION'
       LEFT JOIN cost_entry e ON e.farm_id=m.farm_id AND e.inventory_movement_id=m.id
        AND e.cycle_id=c.cycle_id AND e.status='POSTED' AND e.treatment='PRODUCTION'
        AND e.policy_version=$3
       WHERE c.farm_id=$1 AND c.cycle_id=$2 AND e.id IS NULL
       AND NOT EXISTS (SELECT 1 FROM inventory_movement r WHERE r.farm_id=m.farm_id AND r.reversal_of=m.id)`,
    [farmId, cycleId, financePolicyVersion],
  );
  const completionResult = await tx.query<{ completed_at: string }>(
    "SELECT completed_at::text AS completed_at FROM cycle_cost_completion WHERE farm_id=$1 AND cycle_id=$2",
    [farmId, cycleId],
  );
  const completedAt = completionResult.rows[0]?.completed_at ?? null;
  let current = !!completedAt;
  if (completedAt) {
    const stale = await tx.query<{ stale: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM cost_entry WHERE farm_id=$1
           AND (cycle_id=$2 OR (cycle_id IS NULL AND treatment='UNCLASSIFIED'))
           AND updated_at>$3::timestamptz)
         OR EXISTS(SELECT 1 FROM consumption c JOIN inventory_movement m
           ON m.farm_id=c.farm_id AND m.consumption_id=c.id
           WHERE c.farm_id=$1 AND c.cycle_id=$2 AND m.created_at>$3::timestamptz)
         OR EXISTS(SELECT 1 FROM consumption c JOIN inventory_movement m
           ON m.farm_id=c.farm_id AND m.consumption_id=c.id AND m.type='CONSUMPTION'
           JOIN inventory_movement r ON r.farm_id=m.farm_id AND r.reversal_of=m.id
           WHERE c.farm_id=$1 AND c.cycle_id=$2 AND r.created_at>$3::timestamptz) AS stale`,
      [farmId, cycleId, completedAt],
    );
    current = !stale.rows[0]?.stale;
  }
  const weight = harvests.rows[0]!;
  const cost = costs.rows[0]!;
  const sourceHarvestIds = weight.harvest_ids ?? [];
  const sourceCostIds = cost.cost_ids ?? [];
  let unavailableReason: string | undefined;
  if (!completedAt || !current)
    unavailableReason =
      "Tandai ulang biaya siklus lengkap setelah biaya atau konsumsi terakhir berubah.";
  else if (cost.has_unclassified)
    unavailableReason = "Ada biaya siklus POSTED yang belum diklasifikasikan.";
  else if (Number(consumption.rows[0]?.missing ?? 0) > 0)
    unavailableReason =
      "Ada pemakaian persediaan siklus tanpa biaya produksi terukur.";
  else if (weight.has_missing_weight)
    unavailableReason =
      "Berat kg belum tercatat untuk semua output panen pada siklus.";
  else if (!sourceHarvestIds.length || weight.weight_kg === "0")
    unavailableReason = "Belum ada output panen yang diposting untuk siklus.";
  const costsComplete = !unavailableReason;
  return {
    cycleId,
    cycleName: cycle.name,
    costCompletion: { completedAt, current },
    productionWeightKg: weight.weight_kg,
    hpp: calculateHpp({
      productionCostMinor: cost.total_minor,
      outputQuantity: weight.weight_kg,
      unit: "KG",
      sourceCostIds,
      sourceHarvestIds,
      costsComplete,
      unavailableReason,
      policyVersion: financePolicyVersion,
      asOf: new Date().toISOString(),
    }),
  };
}

export async function getCycleHpp(
  db: Database,
  actorId: string,
  farmId: string,
  cycleId: string,
): Promise<CycleHppProjection> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(cycleId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    return getCycleHppInTransaction(tx, farmId, cycleId);
  });
}

export async function markCycleCostsComplete(
  db: Database,
  context: CommandContext,
  cycleId: string,
  raw: unknown,
) {
  uuid.parse(cycleId);
  const input = completeCycleCostsInput.parse(raw);
  return command(
    db,
    context,
    "finance.completeCycleCosts",
    input.idempotencyKey,
    { cycleId, ...input },
    async (tx) => {
      const cycle = await tx.query<{ id: string }>(
        "SELECT id FROM farming_cycle WHERE farm_id=$1 AND id=$2",
        [context.farmId, cycleId],
      );
      if (!cycle.rows[0]) throw new DomainError("NOT_FOUND");
      await tx.query(
        `INSERT INTO cycle_cost_completion(farm_id,cycle_id,completed_at,completed_by,updated_at)
         VALUES($1,$2,now(),$3,now())
         ON CONFLICT(farm_id,cycle_id) DO UPDATE
         SET completed_at=now(),completed_by=EXCLUDED.completed_by,updated_at=now()`,
        [context.farmId, cycleId, context.actorId],
      );
      const result = await tx.query<{ completed_at: string }>(
        "SELECT completed_at::text AS completed_at FROM cycle_cost_completion WHERE farm_id=$1 AND cycle_id=$2",
        [context.farmId, cycleId],
      );
      return { cycleId, completedAt: result.rows[0]!.completed_at };
    },
  );
}

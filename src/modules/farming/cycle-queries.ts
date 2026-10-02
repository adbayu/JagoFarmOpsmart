import type { Database, Sql } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import type {
  CommoditySummary,
  CycleDetail,
  CycleSummary,
  FarmingType,
  ObservationSummary,
} from "./contracts.js";

async function assertFarmOwner(tx: Sql, actorId: string, farmId: string) {
  const farm = await tx.query<{ id: string }>(
    "SELECT f.id FROM farm f JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2 WHERE f.id=$1 AND f.archived_at IS NULL",
    [farmId, actorId],
  );
  if (!farm.rows[0]) throw new DomainError("FORBIDDEN");
}

type CommodityRow = { id: string; farming_type: FarmingType; name: string };
export async function listCommodities(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<CommoditySummary[]> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    const result = await tx.query<CommodityRow>(
      "SELECT id,farming_type,name FROM commodity WHERE farm_id=$1 ORDER BY farming_type,name,id",
      [farmId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      type: row.farming_type,
      name: row.name,
    }));
  });
}

type CycleRow = {
  id: string;
  unit_id: string;
  unit_name: string;
  commodity_id: string;
  commodity_name: string;
  farming_type: FarmingType;
  name: string;
  status: CycleSummary["status"];
  start_date: string;
  target_harvest_date: string | null;
  ended_at: string | null;
  fish_population: number | null;
  chicken_population: number | null;
  seed_source: string | null;
  initial_weight_g: string | null;
  strain: string | null;
  initial_age_days: number | null;
  seed_count: number | null;
  variety: string | null;
  seedling_date: string | null;
};
const selectCycle = `SELECT c.id,c.unit_id,u.name AS unit_name,c.commodity_id,
  co.name AS commodity_name,c.farming_type,c.name,c.status,
  c.start_date::text AS start_date,
  c.target_harvest_date::text AS target_harvest_date,
  c.ended_at::text AS ended_at,
  fi.initial_population AS fish_population,
  ch.initial_population AS chicken_population,
  COALESCE(fi.seed_source,ch.seed_source) AS seed_source,
  fi.initial_weight_g::text AS initial_weight_g,
  ch.strain,ch.initial_age_days,cr.seed_count,cr.variety,
  cr.seedling_date::text AS seedling_date
  FROM farming_cycle c
  JOIN farm_unit u ON u.farm_id=c.farm_id AND u.id=c.unit_id
  JOIN commodity co ON co.farm_id=c.farm_id AND co.id=c.commodity_id
  LEFT JOIN fish_cycle fi ON fi.farm_id=c.farm_id AND fi.cycle_id=c.id
  LEFT JOIN chicken_cycle ch ON ch.farm_id=c.farm_id AND ch.cycle_id=c.id
  LEFT JOIN crop_cycle cr ON cr.farm_id=c.farm_id AND cr.cycle_id=c.id`;

function summary(row: CycleRow): CycleSummary {
  return {
    id: row.id,
    unitId: row.unit_id,
    unitName: row.unit_name,
    commodityId: row.commodity_id,
    commodityName: row.commodity_name,
    type: row.farming_type,
    name: row.name,
    status: row.status,
    startDate: row.start_date,
    targetHarvestDate: row.target_harvest_date,
    endedAt: row.ended_at,
  };
}
function detail(row: CycleRow): CycleDetail {
  const base = summary(row);
  if (row.farming_type === "FISH") {
    if (row.fish_population === null) throw new DomainError("CONFLICT");
    return {
      ...base,
      type: "FISH",
      initialPopulation: row.fish_population,
      seedSource: row.seed_source,
      initialWeightG: row.initial_weight_g,
    };
  }
  if (row.farming_type === "CHICKEN") {
    if (row.chicken_population === null) throw new DomainError("CONFLICT");
    return {
      ...base,
      type: "CHICKEN",
      initialPopulation: row.chicken_population,
      strain: row.strain,
      initialAgeDays: row.initial_age_days,
      seedSource: row.seed_source,
    };
  }
  if (row.seed_count === null) throw new DomainError("CONFLICT");
  return {
    ...base,
    type: "CROP",
    seedCount: row.seed_count,
    variety: row.variety,
    seedlingDate: row.seedling_date,
  };
}
export async function getCycleInTransaction(
  tx: Sql,
  farmId: string,
  cycleId: string,
): Promise<CycleDetail> {
  const result = await tx.query<CycleRow>(
    `${selectCycle} WHERE c.farm_id=$1 AND c.id=$2`,
    [farmId, cycleId],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND");
  return detail(result.rows[0]);
}
export async function getCycle(
  db: Database,
  actorId: string,
  farmId: string,
  cycleId: string,
): Promise<CycleDetail> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(cycleId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    return getCycleInTransaction(tx, farmId, cycleId);
  });
}
export async function listCycles(
  db: Database,
  actorId: string,
  farmId: string,
  unitId?: string,
): Promise<CycleSummary[]> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  if (unitId) uuid.parse(unitId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    const result = await tx.query<CycleRow>(
      `${selectCycle} WHERE c.farm_id=$1 AND ($2::uuid IS NULL OR c.unit_id=$2)
       ORDER BY c.created_at DESC,c.id DESC`,
      [farmId, unitId ?? null],
    );
    return result.rows.map(summary);
  });
}

type ObservationRow = {
  id: string;
  observed_at: string;
  population_loss: number | null;
  average_weight_g: string | null;
  condition_notes: string | null;
};
export async function listObservations(
  db: Database,
  actorId: string,
  farmId: string,
  cycleId: string,
): Promise<ObservationSummary[]> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(cycleId);
  return db.transaction(async (tx) => {
    await assertFarmOwner(tx, actorId, farmId);
    await getCycleInTransaction(tx, farmId, cycleId);
    const result = await tx.query<ObservationRow>(
      `SELECT id,observed_at::text AS observed_at,population_loss,
       average_weight_g::text AS average_weight_g,condition_notes
       FROM cycle_observation WHERE farm_id=$1 AND cycle_id=$2
       ORDER BY observed_at DESC,id DESC`,
      [farmId, cycleId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      observedAt: row.observed_at,
      populationLoss: row.population_loss,
      averageWeightG: row.average_weight_g,
      conditionNotes: row.condition_notes,
    }));
  });
}

import type { Database, Sql } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import type { FarmingType, UnitSummary } from "./contracts.js";

type UnitRow = {
  id: string;
  farm_id: string;
  farming_type: FarmingType;
  name: string;
  location: string | null;
  active: boolean;
  area_m2: string | null;
  depth_m: string | null;
  media: string | null;
  capacity_heads: number | null;
  capacity_plants: number | null;
  condition: string | null;
};
const selectUnit = `SELECT u.id,u.farm_id,u.farming_type,u.name,u.location,u.active,
  COALESCE(p.area_m2,c.area_m2,g.area_m2)::text AS area_m2,
  p.depth_m::text AS depth_m,p.condition,g.media,
  COALESCE(p.capacity_heads,c.capacity_heads) AS capacity_heads,
  g.capacity_plants
  FROM farm_unit u
  LEFT JOIN pond p ON p.farm_id=u.farm_id AND p.unit_id=u.id
  LEFT JOIN coop c ON c.farm_id=u.farm_id AND c.unit_id=u.id
  LEFT JOIN growing_area g ON g.farm_id=u.farm_id AND g.unit_id=u.id`;
function summary(row: UnitRow): UnitSummary {
  return {
    id: row.id,
    farmId: row.farm_id,
    type: row.farming_type,
    name: row.name,
    location: row.location,
    active: row.active,
    areaM2: row.area_m2,
    depthM: row.depth_m,
    media: row.media,
    capacityHeads: row.capacity_heads,
    capacityPlants: row.capacity_plants,
    condition: row.condition,
  };
}
export async function getUnitInTransaction(
  tx: Sql,
  farmId: string,
  unitId: string,
): Promise<UnitSummary> {
  const result = await tx.query<UnitRow>(
    `${selectUnit} WHERE u.farm_id=$1 AND u.id=$2`,
    [farmId, unitId],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND");
  return summary(result.rows[0]);
}
async function assertOwner(tx: Sql, actorId: string, farmId: string) {
  const farm = await tx.query<{ id: string }>(
    "SELECT f.id FROM farm f JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2 WHERE f.id=$1 AND f.archived_at IS NULL",
    [farmId, actorId],
  );
  if (!farm.rows[0]) throw new DomainError("FORBIDDEN");
}
export async function listUnits(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<UnitSummary[]> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  return db.transaction(async (tx) => {
    await assertOwner(tx, actorId, farmId);
    const result = await tx.query<UnitRow>(
      `${selectUnit} WHERE u.farm_id=$1 AND u.active=true ORDER BY u.created_at DESC,u.id DESC`,
      [farmId],
    );
    return result.rows.map(summary);
  });
}
export async function getUnit(
  db: Database,
  actorId: string,
  farmId: string,
  unitId: string,
): Promise<UnitSummary> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(unitId);
  return db.transaction(async (tx) => {
    await assertOwner(tx, actorId, farmId);
    return getUnitInTransaction(tx, farmId, unitId);
  });
}

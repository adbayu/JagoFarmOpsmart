import type { Database } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import type { FishCycleSummary } from "./contracts.js";

type FishCycleRow = {
  id: string;
  name: string;
  status: FishCycleSummary["status"];
  commodity_name: string;
  start_date: string;
  target_harvest_date: string | null;
};

export async function listFishUnitCycles(
  db: Database,
  actorId: string,
  farmId: string,
  unitId: string,
): Promise<FishCycleSummary[]> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(unitId);
  return db.transaction(async (tx) => {
    const pond = await tx.query<{ id: string }>(
      `SELECT u.id FROM farm_unit u JOIN farm f ON f.id=u.farm_id
       JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$3
       WHERE u.id=$1 AND u.farm_id=$2 AND u.farming_type='FISH'
         AND u.active=true AND f.archived_at IS NULL`,
      [unitId, farmId, actorId],
    );
    if (!pond.rows[0]) throw new DomainError("NOT_FOUND");
    const result = await tx.query<FishCycleRow>(
      `SELECT c.id,c.name,c.status,co.name AS commodity_name,
         c.start_date::text AS start_date,
         c.target_harvest_date::text AS target_harvest_date
       FROM farming_cycle c
       JOIN commodity co ON co.farm_id=c.farm_id AND co.id=c.commodity_id
       WHERE c.farm_id=$1 AND c.unit_id=$2 AND c.farming_type='FISH'
       ORDER BY c.start_date DESC,c.id DESC`,
      [farmId, unitId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      commodityName: row.commodity_name,
      startDate: row.start_date,
      targetHarvestDate: row.target_harvest_date,
    }));
  });
}

import type { Database, Sql } from "../../server/db.js";
import type { FarmSummary } from "./contracts.js";
import { uuid } from "../../shared/validation.js";
import { DomainError } from "../../shared/errors.js";
import { assertFarmMember } from "./access.js";
import type { FarmMemberSummary } from "./contracts.js";

type FarmRow = {
  id: string;
  name: string;
  location: string | null;
  timezone: string;
  currency: "IDR";
  archived_at: Date | string | null;
};
export function farmSummary(row: FarmRow): FarmSummary {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    timezone: row.timezone,
    currency: row.currency,
    archivedAt:
      row.archived_at === null
        ? null
        : row.archived_at instanceof Date
          ? row.archived_at.toISOString()
          : new Date(row.archived_at).toISOString(),
  };
}
export async function getFarmInTransaction(
  tx: Sql,
  actorId: string,
  farmId: string,
): Promise<FarmSummary> {
  await assertFarmMember(tx, actorId, farmId, true);
  const result = await tx.query<FarmRow>(
    "SELECT id,name,location,timezone,currency,archived_at FROM farm WHERE id=$1",
    [farmId],
  );
  if (!result.rows[0]) throw new DomainError("FORBIDDEN");
  return farmSummary(result.rows[0]);
}
export async function getFarm(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<FarmSummary> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  return db.transaction((tx) => getFarmInTransaction(tx, actorId, farmId));
}
export async function listFarms(
  db: Database,
  actorId: string,
): Promise<FarmSummary[]> {
  uuid.parse(actorId);
  return db.transaction(async (tx) => {
    const result = await tx.query<FarmRow>(
      `SELECT f.id,f.name,f.location,f.timezone,f.currency,f.archived_at FROM farm f
      JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$1
      WHERE f.archived_at IS NULL ORDER BY f.created_at DESC,f.id DESC`,
      [actorId],
    );
    return result.rows.map(farmSummary);
  });
}

export async function listFarmMembers(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<{ members: FarmMemberSummary[]; canManageMembers: boolean }> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  return db.transaction(async (tx) => {
    await assertFarmMember(tx, actorId, farmId);
    const farm = await tx.query<{ can_manage_members: boolean }>(
      "SELECT owner_id=$2 AS can_manage_members FROM farm WHERE id=$1",
      [farmId, actorId],
    );
    const result = await tx.query<{
      id: string;
      display_name: string;
      email: string | null;
      joined_at: Date | string;
      is_owner: boolean;
    }>(
      `SELECT u.id,u.display_name,c.email,m.joined_at,
         u.id=f.owner_id AS is_owner
       FROM farm_membership m JOIN farm f ON f.id=m.farm_id
       JOIN app_user u ON u.id=m.user_id
       LEFT JOIN auth_credential c ON c.user_id=u.id
       WHERE m.farm_id=$1 ORDER BY m.joined_at,m.user_id`,
      [farmId],
    );
    return {
      canManageMembers: Boolean(farm.rows[0]?.can_manage_members),
      members: result.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        email: row.email,
        isOwner: row.is_owner,
        joinedAt:
          row.joined_at instanceof Date
            ? row.joined_at.toISOString()
            : new Date(row.joined_at).toISOString(),
      })),
    };
  });
}

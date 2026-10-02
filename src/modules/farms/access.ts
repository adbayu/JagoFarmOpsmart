import type { Sql } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";

export async function assertFarmMember(
  tx: Sql,
  actorId: string,
  farmId: string,
  includeArchived = false,
) {
  const result = await tx.query<{ id: string }>(
    `SELECT f.id FROM farm f
     JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2
     WHERE f.id=$1 AND ($3 OR f.archived_at IS NULL)`,
    [farmId, actorId, includeArchived],
  );
  if (!result.rows[0]) throw new DomainError("FORBIDDEN");
}

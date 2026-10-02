import { randomUUID } from "node:crypto";
import type { Database, Sql } from "../../server/db.js";
import { command } from "../../server/command.js";
import type { CommandContext } from "../../shared/domain.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import {
  archiveUnitInput,
  createUnitInput,
  updateUnitInput,
  type FarmingType,
  type UnitSummary,
} from "./contracts.js";
import { getUnitInTransaction } from "./queries.js";

type UnitDetails = Pick<
  UnitSummary,
  | "areaM2"
  | "depthM"
  | "media"
  | "capacityHeads"
  | "capacityPlants"
  | "condition"
>;
async function insertDetails(
  tx: Sql,
  farmId: string,
  unitId: string,
  type: FarmingType,
  details: UnitDetails,
) {
  if (type === "FISH")
    await tx.query(
      "INSERT INTO pond(unit_id,farm_id,area_m2,depth_m,capacity_heads,condition) VALUES($1,$2,$3,$4,$5,$6)",
      [
        unitId,
        farmId,
        details.areaM2,
        details.depthM,
        details.capacityHeads,
        details.condition,
      ],
    );
  else if (type === "CHICKEN")
    await tx.query(
      "INSERT INTO coop(unit_id,farm_id,area_m2,capacity_heads) VALUES($1,$2,$3,$4)",
      [unitId, farmId, details.areaM2, details.capacityHeads],
    );
  else
    await tx.query(
      "INSERT INTO growing_area(unit_id,farm_id,area_m2,media,capacity_plants) VALUES($1,$2,$3,$4,$5)",
      [unitId, farmId, details.areaM2, details.media, details.capacityPlants],
    );
}
async function updateDetails(
  tx: Sql,
  farmId: string,
  unitId: string,
  type: FarmingType,
  details: UnitDetails,
) {
  const result =
    type === "FISH"
      ? await tx.query<{ unit_id: string }>(
          "UPDATE pond SET area_m2=$3,depth_m=$4,capacity_heads=$5,condition=$6 WHERE farm_id=$1 AND unit_id=$2 RETURNING unit_id",
          [
            farmId,
            unitId,
            details.areaM2,
            details.depthM,
            details.capacityHeads,
            details.condition,
          ],
        )
      : type === "CHICKEN"
        ? await tx.query<{ unit_id: string }>(
            "UPDATE coop SET area_m2=$3,capacity_heads=$4 WHERE farm_id=$1 AND unit_id=$2 RETURNING unit_id",
            [farmId, unitId, details.areaM2, details.capacityHeads],
          )
        : await tx.query<{ unit_id: string }>(
            "UPDATE growing_area SET area_m2=$3,media=$4,capacity_plants=$5 WHERE farm_id=$1 AND unit_id=$2 RETURNING unit_id",
            [
              farmId,
              unitId,
              details.areaM2,
              details.media,
              details.capacityPlants,
            ],
          );
  if (!result.rows[0]) throw new DomainError("CONFLICT");
}
function detailsFor(
  input: {
    type: FarmingType;
    areaM2?: string | null;
    depthM?: string | null;
    media?: string | null;
    capacityHeads?: number | null;
    capacityPlants?: number | null;
    condition?: string | null;
  },
  previous?: UnitSummary,
): UnitDetails {
  const sameType = previous?.type === input.type;
  return {
    areaM2:
      input.areaM2 === undefined && sameType
        ? previous.areaM2
        : (input.areaM2 ?? null),
    depthM:
      input.depthM === undefined && sameType
        ? previous.depthM
        : (input.depthM ?? null),
    media:
      input.media === undefined && sameType
        ? previous.media
        : (input.media ?? null),
    capacityHeads:
      input.capacityHeads === undefined && sameType
        ? previous.capacityHeads
        : (input.capacityHeads ?? null),
    capacityPlants:
      input.capacityPlants === undefined && sameType
        ? previous.capacityPlants
        : (input.capacityPlants ?? null),
    condition:
      input.condition === undefined && sameType
        ? previous.condition
        : (input.condition ?? null),
  };
}
export async function createUnit(
  db: Database,
  context: CommandContext,
  raw: unknown,
): Promise<{ unitId: string }> {
  const { farmId } = context;
  const input = createUnitInput.parse(raw);
  return command(
    db,
    context,
    "farming.createUnit",
    input.idempotencyKey,
    input,
    async (tx) => {
      const unitId = randomUUID();
      await tx.query(
        "INSERT INTO farm_unit(id,farm_id,name,farming_type,location) VALUES($1,$2,$3,$4,$5)",
        [unitId, farmId, input.name, input.type, input.location ?? null],
      );
      await insertDetails(tx, farmId, unitId, input.type, detailsFor(input));
      return { unitId };
    },
  );
}
export async function updateUnit(
  db: Database,
  context: CommandContext,
  unitId: string,
  raw: unknown,
): Promise<UnitSummary> {
  const { farmId } = context;
  uuid.parse(unitId);
  const input = updateUnitInput.parse(raw);
  return command(
    db,
    context,
    "farming.updateUnit",
    input.idempotencyKey,
    { unitId, ...input },
    async (tx) => {
      const current = await getUnitInTransaction(tx, farmId, unitId);
      if (!current.active) throw new DomainError("CONFLICT");
      if (input.type !== current.type) {
        const cycles = await tx.query<{ id: string }>(
          "SELECT id FROM farming_cycle WHERE farm_id=$1 AND unit_id=$2 LIMIT 1",
          [farmId, unitId],
        );
        if (cycles.rows[0]) throw new DomainError("CONFLICT");
      }
      const changingType = input.type !== current.type;
      if (changingType) {
        const table = { FISH: "pond", CHICKEN: "coop", CROP: "growing_area" }[
          current.type
        ];
        await tx.query(`DELETE FROM ${table} WHERE farm_id=$1 AND unit_id=$2`, [
          farmId,
          unitId,
        ]);
      }
      await tx.query(
        `UPDATE farm_unit SET name=$3,location=$4,farming_type=$5,updated_at=now()
        WHERE farm_id=$1 AND id=$2`,
        [
          farmId,
          unitId,
          input.name ?? current.name,
          input.location === undefined ? current.location : input.location,
          input.type,
        ],
      );
      const details = detailsFor(input, current);
      if (changingType)
        await insertDetails(tx, farmId, unitId, input.type, details);
      else await updateDetails(tx, farmId, unitId, input.type, details);
      return getUnitInTransaction(tx, farmId, unitId);
    },
  );
}
export async function archiveUnit(
  db: Database,
  context: CommandContext,
  unitId: string,
  raw: unknown,
): Promise<UnitSummary> {
  const { farmId } = context;
  uuid.parse(unitId);
  const input = archiveUnitInput.parse(raw);
  return command(
    db,
    context,
    "farming.archiveUnit",
    input.idempotencyKey,
    { unitId, ...input },
    async (tx) => {
      const current = await getUnitInTransaction(tx, farmId, unitId);
      if (!current.active) throw new DomainError("CONFLICT");
      const activeCycle = await tx.query<{ id: string }>(
        "SELECT id FROM farming_cycle WHERE farm_id=$1 AND unit_id=$2 AND status IN ('PLANNED','ACTIVE') LIMIT 1",
        [farmId, unitId],
      );
      if (activeCycle.rows[0]) throw new DomainError("CONFLICT");
      await tx.query(
        "UPDATE farm_unit SET active=false,updated_at=now() WHERE farm_id=$1 AND id=$2",
        [farmId, unitId],
      );
      return getUnitInTransaction(tx, farmId, unitId);
    },
  );
}

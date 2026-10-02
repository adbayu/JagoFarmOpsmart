import type { Database, Sql } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import type {
  MaggotBatchDetail,
  MaggotBatchSummary,
  MaggotObservationSummary,
  MaggotOutputPostingSummary,
  MaggotOutputSummary,
  MaggotOutputUseSummary,
} from "./contracts.js";

type BatchRow = {
  id: string;
  started_on: string;
  media: string;
  status: MaggotBatchSummary["status"];
  notes: string | null;
  completion_note: string | null;
  created_by: string;
  created_at: Date | string;
  completed_at: Date | string | null;
};

const iso = (value: Date | string | null): string | null =>
  value === null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();

function summary(row: BatchRow): MaggotBatchSummary {
  return {
    id: row.id,
    startedOn: row.started_on,
    media: row.media,
    status: row.status,
    notes: row.notes,
    completionNote: row.completion_note,
    createdBy: row.created_by,
    createdAt: iso(row.created_at)!,
    completedAt: iso(row.completed_at),
  };
}

async function assertFarmMember(tx: Sql, actorId: string, farmId: string) {
  const result = await tx.query<{ id: string }>(
    `SELECT f.id FROM farm f
     JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2
     WHERE f.id=$1 AND f.archived_at IS NULL`,
    [farmId, actorId],
  );
  if (!result.rows[0]) throw new DomainError("FORBIDDEN");
}

export async function getMaggotBatchInTransaction(
  tx: Sql,
  farmId: string,
  batchId: string,
): Promise<MaggotBatchDetail> {
  const result = await tx.query<BatchRow>(
    `SELECT id,started_on::text,media,status,notes,completion_note,created_by,
       created_at,completed_at
     FROM maggot_batch WHERE farm_id=$1 AND id=$2`,
    [farmId, batchId],
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("NOT_FOUND");

  const inputRows = await tx.query<{
    id: string;
    waste_id: string;
    source: string;
    quantity: string;
    unit: MaggotBatchDetail["inputs"][number]["unit"];
    remaining_quantity: string;
    created_at: Date | string;
  }>(
    `SELECT i.id,i.waste_id,w.source,i.quantity::text,i.unit,
       (w.quantity-COALESCE(used.total,0))::numeric(18,3)::text AS remaining_quantity,
       i.created_at
     FROM maggot_batch_input i
     JOIN waste_record w ON w.farm_id=i.farm_id AND w.id=i.waste_id
     LEFT JOIN LATERAL (
       SELECT sum(i2.quantity) AS total FROM maggot_batch_input i2
       WHERE i2.farm_id=i.farm_id AND i2.waste_id=i.waste_id
     ) used ON true
     WHERE i.farm_id=$1 AND i.batch_id=$2
     ORDER BY i.created_at,i.id`,
    [farmId, batchId],
  );

  const observations = await tx.query<{
    id: string;
    observed_at: Date | string;
    observation: string;
    created_at: Date | string;
  }>(
    `SELECT id,observed_at,observation,created_at FROM maggot_batch_observation
     WHERE farm_id=$1 AND batch_id=$2 ORDER BY observed_at,id`,
    [farmId, batchId],
  );

  const outputRows = await tx.query<{
    id: string;
    harvested_at: Date | string;
    quantity: string;
    unit: MaggotBatchDetail["outputs"][number]["unit"];
    used_quantity: string;
    posted_quantity: string;
    remaining_quantity: string;
    notes: string | null;
  }>(
    `SELECT o.id,o.harvested_at,o.quantity::text,o.unit,
       COALESCE(used.total,0)::numeric(18,3)::text AS used_quantity,
       COALESCE(posted.total,0)::numeric(18,3)::text AS posted_quantity,
       (o.quantity-COALESCE(used.total,0)-COALESCE(posted.total,0))::numeric(18,3)::text AS remaining_quantity,
       o.notes
     FROM maggot_batch_output o
     LEFT JOIN LATERAL (
       SELECT sum(u.quantity) AS total FROM maggot_batch_output_use u
       WHERE u.farm_id=o.farm_id AND u.batch_id=o.batch_id AND u.output_id=o.id
     ) used ON true
     LEFT JOIN LATERAL (
       SELECT sum(p.quantity) AS total FROM circular_maggot_posting p
       WHERE p.farm_id=o.farm_id AND p.batch_id=o.batch_id AND p.output_id=o.id
     ) posted ON true
     WHERE o.farm_id=$1 AND o.batch_id=$2
     ORDER BY o.harvested_at,o.id`,
    [farmId, batchId],
  );
  const usageRows = await tx.query<{
    id: string;
    output_id: string;
    quantity: string;
    purpose: string;
    created_at: Date | string;
  }>(
    `SELECT id,output_id,quantity::text,purpose,created_at
     FROM maggot_batch_output_use WHERE farm_id=$1 AND batch_id=$2
     ORDER BY created_at,id`,
    [farmId, batchId],
  );
  const postingRows = await tx.query<{
    id: string;
    output_id: string;
    movement_id: string;
    lot_id: string;
    item_name: string;
    lot_label: string;
    quantity: string;
    unit: MaggotBatchDetail["outputs"][number]["unit"];
    reason: string;
    created_at: Date | string;
  }>(
    `SELECT p.id,p.output_id,p.movement_id,m.lot_id,i.name AS item_name,
       l.label AS lot_label,p.quantity::text,p.unit,p.reason,p.created_at
     FROM circular_maggot_posting p
     JOIN inventory_movement m ON m.farm_id=p.farm_id AND m.id=p.movement_id
     JOIN inventory_lot l ON l.farm_id=m.farm_id AND l.id=m.lot_id
     JOIN inventory_item i ON i.farm_id=m.farm_id AND i.id=m.inventory_item_id
     WHERE p.farm_id=$1 AND p.batch_id=$2 ORDER BY p.created_at,p.id`,
    [farmId, batchId],
  );
  const uses = new Map<string, MaggotOutputUseSummary[]>();
  for (const item of usageRows.rows) {
    const list = uses.get(item.output_id) ?? [];
    list.push({
      id: item.id,
      quantity: item.quantity,
      purpose: item.purpose,
      createdAt: iso(item.created_at)!,
    });
    uses.set(item.output_id, list);
  }
  const postings = new Map<string, MaggotOutputPostingSummary[]>();
  for (const item of postingRows.rows) {
    const list = postings.get(item.output_id) ?? [];
    list.push({
      id: item.id,
      movementId: item.movement_id,
      lotId: item.lot_id,
      itemName: item.item_name,
      lotLabel: item.lot_label,
      quantity: item.quantity,
      unit: item.unit,
      reason: item.reason,
      createdAt: iso(item.created_at)!,
    });
    postings.set(item.output_id, list);
  }
  const outputSummaries: MaggotOutputSummary[] = outputRows.rows.map(
    (item) => ({
      id: item.id,
      harvestedAt: iso(item.harvested_at)!,
      quantity: item.quantity,
      unit: item.unit,
      usedQuantity: item.used_quantity,
      postedQuantity: item.posted_quantity,
      remainingQuantity: item.remaining_quantity,
      notes: item.notes,
      uses: uses.get(item.id) ?? [],
      postings: postings.get(item.id) ?? [],
    }),
  );
  const observationSummaries: MaggotObservationSummary[] =
    observations.rows.map((item) => ({
      id: item.id,
      observedAt: iso(item.observed_at)!,
      observation: item.observation,
      createdAt: iso(item.created_at)!,
    }));

  return {
    ...summary(row),
    inputs: inputRows.rows.map((item) => ({
      id: item.id,
      wasteId: item.waste_id,
      source: item.source,
      quantity: item.quantity,
      unit: item.unit,
      remainingQuantity: item.remaining_quantity,
      createdAt: iso(item.created_at)!,
    })),
    observations: observationSummaries,
    outputs: outputSummaries,
  };
}

export async function getMaggotBatch(
  db: Database,
  actorId: string,
  farmId: string,
  batchId: string,
): Promise<MaggotBatchDetail> {
  return db.transaction(async (tx) => {
    await assertFarmMember(tx, actorId, farmId);
    return getMaggotBatchInTransaction(tx, farmId, batchId);
  });
}

export async function listMaggotBatches(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<MaggotBatchSummary[]> {
  return db.transaction(async (tx) => {
    await assertFarmMember(tx, actorId, farmId);
    const result = await tx.query<BatchRow>(
      `SELECT id,started_on::text,media,status,notes,completion_note,created_by,
         created_at,completed_at
       FROM maggot_batch WHERE farm_id=$1 ORDER BY started_on DESC,id DESC`,
      [farmId],
    );
    return result.rows.map(summary);
  });
}

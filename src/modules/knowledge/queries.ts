import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import type { Database, Sql } from "../../server/db.js";
import { assertFarmMember } from "../farms/access.js";
import type { KnowledgeSourceSummary } from "./contracts.js";
import { type KnowledgeSourceScope, type KnowledgeSourceStatus } from "./contracts.js";

type SourceRow = {
  id: string;
  scope: KnowledgeSourceScope;
  farm_id: string | null;
  title: string;
  publisher: string;
  rights_evidence: string;
  applicability: string;
  version_label: string;
  original_reference: string;
  effective_at: Date | string;
  review_at: Date | string;
  file_name: string | null;
  media_type: string | null;
  content_sha256: string | null;
  has_file: boolean;
  status: KnowledgeSourceStatus;
  created_by: string;
  created_at: Date | string;
  approved_by: string | null;
  approved_at: Date | string | null;
  revoked_by: string | null;
  revoked_at: Date | string | null;
  content_purged_at: Date | string | null;
};

const asIso = (value: Date | string | null) =>
  value === null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();

function toSummary(row: SourceRow): KnowledgeSourceSummary {
  return {
    id: row.id,
    scope: row.scope,
    farmId: row.farm_id,
    title: row.title,
    publisher: row.publisher,
    rightsEvidence: row.rights_evidence,
    applicability: row.applicability,
    versionLabel: row.version_label,
    originalReference: row.original_reference,
    effectiveAt: asIso(row.effective_at)!,
    reviewAt: asIso(row.review_at)!,
    fileName: row.file_name,
    mediaType: row.media_type,
    contentSha256: row.content_sha256?.trim() ?? null,
    hasFile: row.has_file,
    status: row.status,
    createdBy: row.created_by,
    createdAt: asIso(row.created_at)!,
    approvedBy: row.approved_by,
    approvedAt: asIso(row.approved_at),
    revokedBy: row.revoked_by,
    revokedAt: asIso(row.revoked_at),
    contentPurgedAt: asIso(row.content_purged_at),
  };
}

export async function listKnowledgeSourcesInTransaction(
  tx: Sql,
  actorId: string,
  farmId: string,
): Promise<KnowledgeSourceSummary[]> {
  await assertFarmMember(tx, actorId, farmId, true);
  const result = await tx.query<SourceRow>(
    `SELECT id,scope,farm_id,title,publisher,rights_evidence,applicability,
      version_label,original_reference,effective_at,review_at,file_name,media_type,
      content_sha256,(content IS NOT NULL) AS has_file,status,created_by,created_at,
      approved_by,approved_at,revoked_by,revoked_at,content_purged_at
     FROM knowledge_source
     WHERE scope='SHARED' OR farm_id=$1
     ORDER BY CASE WHEN status='ACTIVE' AND review_at <= clock_timestamp() THEN 0 ELSE 1 END,
       created_at DESC,id DESC
     LIMIT 200`,
    [farmId],
  );
  return result.rows.map(toSummary);
}

export async function listKnowledgeSources(
  db: Database,
  actorId: string,
  farmId: string,
): Promise<KnowledgeSourceSummary[]> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  return db.transaction((tx) =>
    listKnowledgeSourcesInTransaction(tx, actorId, farmId),
  );
}

export async function getKnowledgeSourceFile(
  db: Database,
  actorId: string,
  farmId: string,
  sourceId: string,
): Promise<{ fileName: string; bytes: Buffer }> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(sourceId);
  return db.transaction(async (tx) => {
    await assertFarmMember(tx, actorId, farmId, true);
    const result = await tx.query<{
      farm_id: string | null;
      file_name: string | null;
      content: Buffer | null;
    }>(
      `SELECT farm_id,file_name,content FROM knowledge_source
       WHERE id=$1 AND (scope='SHARED' OR farm_id=$2)`,
      [sourceId, farmId],
    );
    const source = result.rows[0];
    if (!source) throw new DomainError("NOT_FOUND");
    if (!source.file_name || !source.content) throw new DomainError("NOT_FOUND");
    return { fileName: source.file_name, bytes: source.content };
  });
}

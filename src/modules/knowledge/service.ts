import { createHash, randomUUID } from "node:crypto";
import type { CommandContext } from "../../shared/domain.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import { command } from "../../server/command.js";
import type { Database, Sql } from "../../server/db.js";
import {
  createKnowledgeSourceInput,
  knowledgeSourceActionInput,
  type KnowledgeSourceSummary,
} from "./contracts.js";

const maxFileBytes = 5 * 1024 * 1024;

type SourceRow = {
  id: string;
  scope: "SHARED" | "FARM";
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
  has_file?: boolean;
  status: "PENDING_REVIEW" | "ACTIVE" | "REVOKED" | "EXPIRED";
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

function summary(row: SourceRow): KnowledgeSourceSummary {
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
    hasFile: row.has_file ?? row.file_name !== null,
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

async function insertEvent(
  tx: Sql,
  sourceId: string,
  actorId: string | null,
  type: "CREATED" | "FILE_ATTACHED" | "APPROVED" | "REVOKED" | "EXPIRED",
  metadata: Record<string, unknown> = {},
) {
  await tx.query(
    `INSERT INTO knowledge_source_event(id,source_id,actor_id,event_type,metadata)
     VALUES($1,$2,$3,$4,$5)`,
    [randomUUID(), sourceId, actorId, type, JSON.stringify(metadata)],
  );
}

export async function createKnowledgeSource(
  db: Database,
  context: CommandContext,
  input: unknown,
): Promise<KnowledgeSourceSummary> {
  const parsed = createKnowledgeSourceInput.parse(input);
  const effectiveAt = new Date(parsed.effectiveAt);
  const reviewAt = new Date(parsed.reviewAt);
  if (reviewAt <= effectiveAt || reviewAt.getTime() <= Date.now())
    throw new DomainError("VALIDATION");

  return command(
    db,
    context,
    "knowledge.sources.create",
    parsed.idempotencyKey,
    parsed,
    async (tx) => {
      const id = randomUUID();
      const farmId = parsed.scope === "FARM" ? context.farmId : null;
      const result = await tx.query<SourceRow>(
        `INSERT INTO knowledge_source(
          id,scope,farm_id,title,publisher,rights_evidence,applicability,
          version_label,original_reference,effective_at,review_at,created_by,changed_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
        RETURNING *`,
        [
          id,
          parsed.scope,
          farmId,
          parsed.title,
          parsed.publisher,
          parsed.rightsEvidence,
          parsed.applicability,
          parsed.versionLabel,
          parsed.originalReference,
          effectiveAt,
          reviewAt,
          context.actorId,
        ],
      );
      await insertEvent(tx, id, context.actorId, "CREATED", {
        scope: parsed.scope,
        farmId,
      });
      return summary(result.rows[0]!);
    },
  );
}

function validateSourceFile(fileName: string, bytes: Buffer) {
  const safeName = fileName.trim();
  if (
    !safeName ||
    safeName.length > 180 ||
    /[\\/\u0000-\u001f\u007f]/.test(safeName) ||
    bytes.length === 0 ||
    bytes.length > maxFileBytes
  ) {
    throw new DomainError(bytes.length > maxFileBytes ? "PAYLOAD_TOO_LARGE" : "VALIDATION");
  }

  const extension = safeName.split(".").at(-1)?.toLowerCase();
  if (extension === "pdf") {
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-")
      throw new DomainError("VALIDATION");
    return {
      fileName: safeName,
      mediaType: "application/pdf",
      hash: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  if (extension !== "md" && extension !== "txt")
    throw new DomainError("VALIDATION");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DomainError("VALIDATION");
  }
  if (!text.trim() || text.includes("\u0000")) throw new DomainError("VALIDATION");
  return {
    fileName: safeName,
    mediaType: extension === "md" ? "text/markdown" : "text/plain",
    hash: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function attachKnowledgeSourceFile(
  db: Database,
  context: CommandContext,
  sourceId: string,
  key: string,
  fileName: string,
  bytes: Buffer,
): Promise<KnowledgeSourceSummary> {
  const id = uuid.parse(sourceId);
  const idempotencyKey = uuid.parse(key);
  const file = validateSourceFile(fileName, bytes);
  return command(
    db,
    context,
    "knowledge.sources.file",
    idempotencyKey,
    { sourceId: id, fileName: file.fileName, mediaType: file.mediaType, hash: file.hash },
    async (tx) => {
      const current = await tx.query<SourceRow & { content: Buffer | null }>(
        "SELECT * FROM knowledge_source WHERE id=$1 FOR UPDATE",
        [id],
      );
      const source = current.rows[0];
      if (!source || (source.farm_id && source.farm_id !== context.farmId))
        throw new DomainError("NOT_FOUND");
      if (source.status !== "PENDING_REVIEW" || source.content)
        throw new DomainError("CONFLICT");
      const updated = await tx.query<SourceRow>(
        `UPDATE knowledge_source SET file_name=$2,media_type=$3,content_sha256=$4,
          content=$5,changed_by=$6,changed_at=clock_timestamp()
         WHERE id=$1 RETURNING *`,
        [id, file.fileName, file.mediaType, file.hash, bytes, context.actorId],
      );
      await insertEvent(tx, id, context.actorId, "FILE_ATTACHED", {
        fileName: file.fileName,
        mediaType: file.mediaType,
        sha256: file.hash,
        sizeBytes: bytes.length,
      });
      return summary(updated.rows[0]!);
    },
  );
}

export async function approveKnowledgeSource(
  db: Database,
  context: CommandContext,
  sourceId: string,
  input: unknown,
): Promise<KnowledgeSourceSummary> {
  const id = uuid.parse(sourceId);
  const parsed = knowledgeSourceActionInput.parse(input);
  return command(
    db,
    context,
    "knowledge.sources.approve",
    parsed.idempotencyKey,
    { sourceId: id },
    async (tx) => {
      const current = await tx.query<SourceRow & { content: Buffer | null }>(
        "SELECT * FROM knowledge_source WHERE id=$1 FOR UPDATE",
        [id],
      );
      const source = current.rows[0];
      if (!source || (source.farm_id && source.farm_id !== context.farmId))
        throw new DomainError("NOT_FOUND");
      if (
        source.status !== "PENDING_REVIEW" ||
        source.created_by === context.actorId ||
        !source.content ||
        !source.file_name ||
        !source.content_sha256 ||
        new Date(source.review_at).getTime() <= Date.now()
      ) {
        throw new DomainError("CONFLICT");
      }
      const updated = await tx.query<SourceRow>(
        `UPDATE knowledge_source SET status='ACTIVE',approved_by=$2,
          approved_at=clock_timestamp(),changed_by=$2,changed_at=clock_timestamp()
         WHERE id=$1 RETURNING *`,
        [id, context.actorId],
      );
      await insertEvent(tx, id, context.actorId, "APPROVED");
      return summary(updated.rows[0]!);
    },
  );
}

export async function revokeKnowledgeSource(
  db: Database,
  context: CommandContext,
  sourceId: string,
  input: unknown,
): Promise<KnowledgeSourceSummary> {
  const id = uuid.parse(sourceId);
  const parsed = knowledgeSourceActionInput.parse(input);
  return command(
    db,
    context,
    "knowledge.sources.revoke",
    parsed.idempotencyKey,
    { sourceId: id },
    async (tx) => {
      const current = await tx.query<SourceRow>(
        "SELECT * FROM knowledge_source WHERE id=$1 FOR UPDATE",
        [id],
      );
      const source = current.rows[0];
      if (!source || (source.farm_id && source.farm_id !== context.farmId))
        throw new DomainError("NOT_FOUND");
      if (source.status !== "PENDING_REVIEW" && source.status !== "ACTIVE")
        throw new DomainError("CONFLICT");
      const updated = await tx.query<SourceRow>(
        `UPDATE knowledge_source SET status='REVOKED',revoked_by=$2,
          revoked_at=clock_timestamp(),content_purge_after=clock_timestamp()+interval '23 hours',
          metadata_purge_after=clock_timestamp()+interval '90 days',
          changed_by=$2,changed_at=clock_timestamp()
         WHERE id=$1 RETURNING *`,
        [id, context.actorId],
      );
      await insertEvent(tx, id, context.actorId, "REVOKED");
      return summary(updated.rows[0]!);
    },
  );
}

export async function expireAndPurgeKnowledgeSources(
  db: Database,
  now = new Date(),
): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await tx.query<SourceRow>(
      `SELECT * FROM knowledge_source
       WHERE status IN ('PENDING_REVIEW','ACTIVE') AND review_at <= $1
       ORDER BY review_at,id LIMIT 500 FOR UPDATE SKIP LOCKED`,
      [now],
    );
    for (const source of due.rows) {
      await tx.query(
        `UPDATE knowledge_source SET status='EXPIRED',changed_at=$2,
          content_purge_after=review_at + interval '23 hours',
          metadata_purge_after=review_at + interval '90 days'
         WHERE id=$1`,
        [source.id, now],
      );
      await insertEvent(tx, source.id, null, "EXPIRED");
    }
    const purged = await tx.query<{ count: string }>(
      "SELECT purge_knowledge_sources(500) AS count",
    );
    return Number(purged.rows[0]?.count ?? 0);
  });
}

import { z } from "zod";
import { uuid } from "../../shared/validation.js";

export const knowledgeSourceScope = z.enum(["SHARED", "FARM"]);
export const knowledgeSourceStatus = z.enum([
  "PENDING_REVIEW",
  "ACTIVE",
  "REVOKED",
  "EXPIRED",
]);

const shortText = (max: number) => z.string().trim().min(1).max(max);
const dateTime = z.string().datetime({ offset: true });

export const createKnowledgeSourceInput = z.strictObject({
  idempotencyKey: uuid,
  scope: knowledgeSourceScope,
  title: shortText(200),
  publisher: shortText(200),
  rightsEvidence: shortText(2000),
  applicability: shortText(1000),
  versionLabel: shortText(100),
  originalReference: shortText(1000),
  effectiveAt: dateTime,
  reviewAt: dateTime,
});

export const knowledgeSourceActionInput = z.strictObject({
  idempotencyKey: uuid,
});

export type KnowledgeSourceScope = z.infer<typeof knowledgeSourceScope>;
export type KnowledgeSourceStatus = z.infer<typeof knowledgeSourceStatus>;

export type KnowledgeSourceSummary = {
  id: string;
  scope: KnowledgeSourceScope;
  farmId: string | null;
  title: string;
  publisher: string;
  rightsEvidence: string;
  applicability: string;
  versionLabel: string;
  originalReference: string;
  effectiveAt: string;
  reviewAt: string;
  fileName: string | null;
  mediaType: string | null;
  contentSha256: string | null;
  hasFile: boolean;
  status: KnowledgeSourceStatus;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  revokedBy: string | null;
  revokedByName: string | null;
  revokedAt: string | null;
  contentPurgedAt: string | null;
};

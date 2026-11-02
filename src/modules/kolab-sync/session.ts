import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DomainError } from "../../shared/errors.js";
import { kolabSessionInput, type KolabSessionState } from "./contracts.js";

export interface EncryptedKolabSession {
  encryptedState: Buffer;
  nonce: Buffer;
  authTag: Buffer;
}

export class KolabSessionInvalidError extends Error {}

function encryptionKey(): Buffer | null {
  const configured = process.env.KOLAB_SESSION_ENCRYPTION_KEY?.trim();
  if (!configured) return null;
  const key = Buffer.from(configured, "base64");
  return key.length === 32 ? key : null;
}

export function kolabSyncEnabled(): boolean {
  return process.env.KOLAB_SYNC_ENABLED === "true" && encryptionKey() !== null;
}

export function encryptKolabSession(
  state: KolabSessionState,
  actorId: string,
): EncryptedKolabSession {
  const key = encryptionKey();
  if (!key) throw new DomainError("INTEGRATION_NOT_READY");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(actorId, "utf8"));
  const encryptedState = Buffer.concat([
    cipher.update(JSON.stringify(state), "utf8"),
    cipher.final(),
  ]);
  return { encryptedState, nonce, authTag: cipher.getAuthTag() };
}

export function decryptKolabSession(
  encrypted: EncryptedKolabSession,
  actorId: string,
): KolabSessionState {
  const key = encryptionKey();
  if (!key) throw new DomainError("INTEGRATION_NOT_READY");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, encrypted.nonce);
    decipher.setAAD(Buffer.from(actorId, "utf8"));
    decipher.setAuthTag(encrypted.authTag);
    const state = Buffer.concat([
      decipher.update(encrypted.encryptedState),
      decipher.final(),
    ]).toString("utf8");
    return kolabSessionInput.parse(JSON.parse(state));
  } catch {
    throw new KolabSessionInvalidError();
  }
}

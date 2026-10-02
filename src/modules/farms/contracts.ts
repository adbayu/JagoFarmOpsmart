import { z } from "zod";
import { uuid } from "../../shared/validation.js";
export const createFarmInput = z.strictObject({
  idempotencyKey: uuid,
  name: z.string().trim().min(1).max(120),
  location: z.string().max(500).optional(),
});
export const updateFarmInput = z
  .strictObject({
    idempotencyKey: uuid,
    name: z.string().trim().min(1).max(120).optional(),
    location: z.string().max(500).nullable().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.location !== undefined,
    "Name or location is required",
  );
export const archiveFarmInput = z.strictObject({ idempotencyKey: uuid });
export const addFarmMemberInput = z.strictObject({
  idempotencyKey: uuid,
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
});
export const removeFarmMemberInput = z.strictObject({ idempotencyKey: uuid });
export type FarmSummary = {
  id: string;
  name: string;
  location: string | null;
  timezone: string;
  currency: "IDR";
  archivedAt: string | null;
};
export type FarmMemberSummary = {
  id: string;
  displayName: string;
  email: string | null;
  joinedAt: string;
  isOwner: boolean;
};

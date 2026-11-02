import { z } from "zod";
import { dateOnly } from "../../shared/validation.js";
import { kolabDeliveryStatuses } from "../../shared/domain.js";

const kolabOrigin = "https://absen.kolab.top";
const storageEntry = z
  .object({ name: z.string().min(1).max(256), value: z.string().max(8192) })
  .strict();
const cookie = z
  .object({
    name: z.string().min(1).max(256),
    value: z.string().max(4096),
    domain: z
      .string()
      .min(1)
      .max(255)
      .refine((domain) => {
        const normalized = domain.toLowerCase().replace(/^\./, "");
        return normalized === "kolab.top" || normalized === "absen.kolab.top";
      }),
    path: z.string().max(2048),
    expires: z.number().finite(),
    httpOnly: z.boolean(),
    secure: z.boolean(),
    sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
  })
  .strict();
const originState = z
  .object({
    origin: z
      .string()
      .url()
      .refine((origin) => origin === kolabOrigin),
    localStorage: z.array(storageEntry).max(100),
  })
  .strict();
const browserState = z
  .object({
    cookies: z.array(cookie).max(100),
    origins: z.array(originState).max(1),
  })
  .strict();
const sessionStorage = z.array(storageEntry).max(100);

export const kolabSessionInput = z
  .object({ storageState: browserState, sessionStorage })
  .strict()
  .superRefine((value, ctx) => {
    const byteSize = new TextEncoder().encode(JSON.stringify(value)).length;
    if (byteSize > 80_000)
      ctx.addIssue({ code: "custom", message: "Session file is too large." });
    if (
      value.storageState.cookies.length === 0 &&
      value.storageState.origins.every(
        (origin) => origin.localStorage.length === 0,
      ) &&
      value.sessionStorage.length === 0
    )
      ctx.addIssue({
        code: "custom",
        message: "Session file has no login state.",
      });
  });

export type KolabSessionState = z.infer<typeof kolabSessionInput>;
export type KolabDeliveryStatus = (typeof kolabDeliveryStatuses)[number];

const timestamp = z.iso.datetime({ offset: true });
export const kolabSyncStatusSchema = z.object({
  enabled: z.boolean(),
  connectedAt: timestamp.nullable(),
  deliveries: z.array(
    z.object({
      date: dateOnly,
      status: z.enum(kolabDeliveryStatuses),
      attemptCount: z.number().int().nonnegative(),
      completedAt: timestamp.nullable(),
      lastErrorCode: z.string().max(64).nullable(),
    }),
  ),
});

export const emptyKolabInput = z.object({}).strict();
export type KolabSyncStatus = z.infer<typeof kolabSyncStatusSchema>;

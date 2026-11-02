import { z } from "zod";
import { dateOnly, uuid } from "../../shared/validation.js";
import { standupDayStates, standupStatuses } from "../../shared/domain.js";

export const standupSaveInput = z
  .object({
    idempotencyKey: uuid,
    date: dateOnly,
    version: z.number().int().min(0).max(2147483646),
    todayPlan: z.string().max(6000),
    previousWork: z.string().max(6000),
    blockers: z.string().max(6000),
    publish: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.publish && !value.todayPlan.trim())
      ctx.addIssue({
        code: "custom",
        path: ["todayPlan"],
        message: "Rencana hari ini wajib diisi.",
      });
  });

export const reminderInput = z.object({ date: dateOnly }).strict();
export const recapInput = z.object({ date: dateOnly }).strict();
export interface StandupFields {
  todayPlan: string;
  previousWork: string;
  blockers: string;
}
export interface OwnStandup extends StandupFields {
  version: number;
  publishedAt: string | null;
  published: StandupFields | null;
}
export interface StandupDay {
  date: string;
  today: string;
  serverNow: string;
  deadline: string;
  startsOn: string;
  state: (typeof standupDayStates)[number];
  calendarVerified: boolean;
  calendarStale: boolean;
  holiday: string | null;
}
export interface CurrentStandup extends StandupDay {
  eligible: boolean;
  status: (typeof standupStatuses)[number] | null;
  own: OwnStandup;
}
export interface StandupRecap extends StandupDay {
  users: {
    userId: string;
    displayName: string;
    status: (typeof standupStatuses)[number];
    published: (StandupFields & { publishedAt: string }) | null;
  }[];
}

const fieldsSchema = z.object({
  todayPlan: z.string().max(6000),
  previousWork: z.string().max(6000),
  blockers: z.string().max(6000),
});
const timestamp = z.iso.datetime({ offset: true });
export const ownStandupSchema = fieldsSchema
  .extend({
    version: z.number().int().min(0),
    publishedAt: timestamp.nullable(),
    published: fieldsSchema.nullable(),
  })
  .refine(
    (value) => (value.published === null) === (value.publishedAt === null),
  );
const daySchema = z.object({
  date: dateOnly,
  today: dateOnly,
  serverNow: timestamp,
  deadline: timestamp,
  startsOn: dateOnly,
  state: z.enum(standupDayStates),
  calendarVerified: z.boolean(),
  calendarStale: z.boolean(),
  holiday: z.string().nullable(),
});
export const currentStandupSchema = daySchema.extend({
  eligible: z.boolean(),
  status: z.enum(standupStatuses).nullable(),
  own: ownStandupSchema,
});
export const standupRecapSchema = daySchema.extend({
  users: z.array(
    z.object({
      userId: uuid,
      displayName: z.string(),
      status: z.enum(standupStatuses),
      published: fieldsSchema.extend({ publishedAt: timestamp }).nullable(),
    }),
  ),
});
export const reminderResultSchema = z.object({ show: z.boolean() });

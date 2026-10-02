import { z } from "zod";
import { activityKinds, activityStatuses } from "../../shared/domain.js";
import type { ActivityStatus, FarmingType } from "../../shared/domain.js";
import { uuid } from "../../shared/validation.js";
export const createActivityInput = z.strictObject({
  idempotencyKey: uuid,
  cycleId: uuid,
  kind: z.enum(activityKinds),
  scheduledAt: z.iso.datetime({ offset: true }),
  notes: z.string().max(2000).optional(),
});
export const transitionActivityInput = z.strictObject({
  idempotencyKey: uuid,
  activityId: uuid,
  expectedStatus: z.enum(activityStatuses),
  status: z.enum(activityStatuses),
});

export type ActivitySummary = {
  id: string;
  cycleId: string;
  cycleName: string;
  type: FarmingType;
  kind: (typeof activityKinds)[number];
  status: ActivityStatus;
  scheduledAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  notes: string | null;
};

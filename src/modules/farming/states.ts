import type { ActivityStatus, CycleStatus } from "../../shared/domain.js";
import { DomainError } from "../../shared/errors.js";
const cycles: Record<CycleStatus, readonly CycleStatus[]> = {
  PLANNED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};
const activities: Record<ActivityStatus, readonly ActivityStatus[]> = {
  SCHEDULED: ["IN_PROGRESS", "COMPLETED", "MISSED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  MISSED: ["IN_PROGRESS", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};
export function assertCycleTransition(
  from: CycleStatus,
  to: CycleStatus,
): void {
  if (!cycles[from].includes(to)) throw new DomainError("CONFLICT");
}
export function assertActivityTransition(
  from: ActivityStatus,
  to: ActivityStatus,
): void {
  if (!activities[from].includes(to)) throw new DomainError("CONFLICT");
}

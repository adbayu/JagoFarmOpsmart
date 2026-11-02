import { z } from "zod";
import type { Database } from "../../server/db.js";

const holiday = z.object({
  date: z.iso.date(),
  name: z.string().min(1).max(500),
  type: z.enum(["national_holiday", "joint_leave"]),
});
const annualResponse = z.object({
  meta: z.object({
    year: z.number().int(),
    count: z.number().int().positive(),
  }),
  data: z.array(holiday).min(1).max(400),
});
export type Holiday = z.infer<typeof holiday>;
export interface Calendar {
  days: Holiday[];
  verified: boolean;
  stale: boolean;
}
export interface StandupRuntime {
  now?: () => Date;
  fetchCalendar?: (year: number) => Promise<unknown>;
}

export function createHolidayCalendar(
  db: Database,
  runtime: StandupRuntime = {},
) {
  const pending = new Map<number, Promise<Calendar>>();
  const failedUntil = new Map<number, number>();
  const now = runtime.now ?? (() => new Date());
  const fetchCalendar =
    runtime.fetchCalendar ??
    (async (year: number) => {
      const response = await fetch(
        `https://indonesian-holidays.ahrulsyamil.com/holidays/${year}`,
        {
          signal: AbortSignal.timeout(5000),
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) throw new Error("Holiday calendar unavailable");
      return response.json();
    });
  async function read(year: number): Promise<Calendar> {
    const cached = await db.transaction(
      async (tx) =>
        (
          await tx.query<{
            days: unknown;
            fetchedAt: Date | string;
          }>(
            `SELECT days, fetched_at AS "fetchedAt" FROM standup_holiday_calendar WHERE year=$1`,
            [year],
          )
        ).rows[0],
    );
    const parsed = z.array(holiday).min(1).safeParse(cached?.days);
    const days = parsed.success ? parsed.data : null;
    const age = cached
      ? now().getTime() - new Date(cached.fetchedAt).getTime()
      : Infinity;
    if (days && age >= 0 && age < 86_400_000)
      return { days, verified: true, stale: false };
    if ((failedUntil.get(year) ?? 0) > now().getTime())
      return {
        days: days ?? [],
        verified: Boolean(days),
        stale: Boolean(days),
      };
    try {
      const response = annualResponse.parse(await fetchCalendar(year));
      if (
        response.meta.year !== year ||
        response.meta.count !== response.data.length ||
        response.data.some((day) => !day.date.startsWith(`${year}-`))
      )
        throw new Error("Invalid calendar year");
      const stamp = now().toISOString();
      await db.transaction((tx) =>
        tx.query(
          `INSERT INTO standup_holiday_calendar(year,days,fetched_at,updated_at)
        VALUES($1,$2::jsonb,$3,$3) ON CONFLICT(year) DO UPDATE SET
        days=EXCLUDED.days,fetched_at=EXCLUDED.fetched_at,updated_at=EXCLUDED.updated_at
        WHERE standup_holiday_calendar.fetched_at <= EXCLUDED.fetched_at`,
          [year, JSON.stringify(response.data), stamp],
        ),
      );
      failedUntil.delete(year);
      return { days: response.data, verified: true, stale: false };
    } catch {
      failedUntil.set(year, now().getTime() + 300_000);
      return {
        days: days ?? [],
        verified: Boolean(days),
        stale: Boolean(days),
      };
    }
  }
  return {
    get(year: number): Promise<Calendar> {
      const existing = pending.get(year);
      if (existing) return existing;
      const request = read(year).finally(() => pending.delete(year));
      pending.set(year, request);
      return request;
    },
  };
}

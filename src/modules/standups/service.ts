import { createHash, randomUUID } from "node:crypto";
import type { Database, Sql } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { dateOnly, uuid } from "../../shared/validation.js";
import {
  createHolidayCalendar,
  type Calendar,
  type StandupRuntime,
} from "./calendar.js";
import {
  standupSaveInput,
  reminderInput,
  recapInput,
  type CurrentStandup,
  type OwnStandup,
  type StandupDay,
  type StandupRecap,
} from "./contracts.js";

export function wibDate(now: Date): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}
function iso(value: string | Date): string {
  return new Date(value).toISOString();
}
function dayState(
  date: string,
  now: Date,
  startsOn: string,
  calendar: Calendar,
): StandupDay {
  const today = wibDate(now);
  const deadline = `${date}T12:00:00+07:00`;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const holiday = calendar.days.find((day) => day.date === date)?.name ?? null;
  const state =
    date < startsOn
      ? "NOT_STARTED"
      : weekday === 0 || weekday === 6 || holiday
        ? "DAY_OFF"
        : date < today || now.getTime() >= new Date(deadline).getTime()
          ? "CLOSED"
          : "OPEN";
  return {
    date,
    today,
    serverNow: now.toISOString(),
    deadline,
    startsOn,
    state,
    calendarVerified: calendar.verified,
    calendarStale: calendar.stale,
    holiday,
  };
}
const emptyOwn = (): OwnStandup => ({
  version: 0,
  todayPlan: "",
  previousWork: "",
  blockers: "",
  publishedAt: null,
  published: null,
});
async function own(tx: Sql, actor: string, date: string): Promise<OwnStandup> {
  const row = (
    await tx.query<{
      version: number;
      todayPlan: string;
      previousWork: string;
      blockers: string;
      publishedAt: Date | string | null;
      publishedPlan: string | null;
      publishedPrevious: string | null;
      publishedBlockers: string | null;
    }>(
      `SELECT version, draft_plan AS "todayPlan", draft_previous AS "previousWork", draft_blockers AS blockers,
      published_at AS "publishedAt", published_plan AS "publishedPlan", published_previous AS "publishedPrevious",
      published_blockers AS "publishedBlockers" FROM daily_standup WHERE user_id=$1 AND report_date=$2`,
      [actor, date],
    )
  ).rows[0];
  if (!row) return emptyOwn();
  return {
    version: row.version,
    todayPlan: row.todayPlan,
    previousWork: row.previousWork,
    blockers: row.blockers,
    publishedAt: row.publishedAt ? iso(row.publishedAt) : null,
    published: row.publishedAt
      ? {
          todayPlan: row.publishedPlan!,
          previousWork: row.publishedPrevious!,
          blockers: row.publishedBlockers!,
        }
      : null,
  };
}

export function createStandups(db: Database, runtime: StandupRuntime = {}) {
  const clock = runtime.now ?? (() => new Date());
  const calendars = createHolidayCalendar(db, runtime);
  async function setup(tx: Sql, actor: string, lock = false) {
    const user = (
      await tx.query<{ createdDate: string }>(
        `SELECT (created_at AT TIME ZONE 'Asia/Jakarta')::date::text AS "createdDate"
      FROM app_user WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
        [actor],
      )
    ).rows[0];
    if (!user) throw new DomainError("UNAUTHORIZED");
    const settings = (
      await tx.query<{ startsOn: string }>(
        'SELECT starts_on::text AS "startsOn" FROM standup_settings WHERE id=true',
      )
    ).rows[0];
    if (!settings) throw new DomainError("INTERNAL");
    return { createdDate: user.createdDate, startsOn: settings.startsOn };
  }
  async function calendar(date: string) {
    dateOnly.parse(date);
    const year = Number(date.slice(0, 4));
    if (year < 2000 || year > 2100) throw new DomainError("VALIDATION");
    return calendars.get(year);
  }
  async function current(actor: string): Promise<CurrentStandup> {
    uuid.parse(actor);
    const date = wibDate(clock());
    const holidays = await calendar(date);
    return db.transaction(async (tx) => {
      const config = await setup(tx, actor);
      const day = dayState(date, clock(), config.startsOn, holidays);
      const report = await own(tx, actor, date);
      const eligible =
        config.createdDate < date && ["OPEN", "CLOSED"].includes(day.state);
      return {
        ...day,
        state:
          ["OPEN", "CLOSED"].includes(day.state) && !eligible
            ? "NOT_ELIGIBLE"
            : day.state,
        eligible,
        own: report,
        status: report.publishedAt
          ? "SUBMITTED"
          : eligible
            ? day.state === "CLOSED"
              ? "MISSED"
              : "PENDING"
            : null,
      };
    });
  }
  async function recap(actor: string, raw: unknown): Promise<StandupRecap> {
    const { date } = recapInput.parse(raw);
    if (date > wibDate(clock())) throw new DomainError("VALIDATION");
    const holidays = await calendar(date);
    return db.transaction(async (tx) => {
      const config = await setup(tx, actor);
      const day = dayState(date, clock(), config.startsOn, holidays);
      if (day.state === "NOT_STARTED") return { ...day, users: [] };
      const working = day.state === "OPEN" || day.state === "CLOSED";
      // Historical publications remain readable even if a later calendar revision adds a holiday.
      const rows = (
        await tx.query<{
          userId: string;
          displayName: string;
          publishedAt: string | Date | null;
          todayPlan: string | null;
          previousWork: string | null;
          blockers: string | null;
        }>(
          `SELECT u.id AS "userId",u.display_name AS "displayName",s.published_at AS "publishedAt",
        s.published_plan AS "todayPlan",s.published_previous AS "previousWork",s.published_blockers AS blockers
        FROM app_user u LEFT JOIN daily_standup s ON s.user_id=u.id AND s.report_date=$1
        WHERE ((u.created_at AT TIME ZONE 'Asia/Jakarta')::date < $1::date AND $2::boolean)
          OR s.published_at IS NOT NULL
        ORDER BY lower(u.display_name),u.id`,
          [date, working],
        )
      ).rows;
      return {
        ...day,
        users: rows.map((row) => ({
          userId: row.userId,
          displayName: row.displayName,
          status: row.publishedAt
            ? "SUBMITTED"
            : day.state === "CLOSED"
              ? "MISSED"
              : "PENDING",
          published: row.publishedAt
            ? {
                todayPlan: row.todayPlan!,
                previousWork: row.previousWork!,
                blockers: row.blockers!,
                publishedAt: iso(row.publishedAt),
              }
            : null,
        })),
      };
    });
  }
  async function save(actor: string, raw: unknown): Promise<OwnStandup> {
    const input = standupSaveInput.parse(raw);
    const holidays = await calendar(input.date);
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    return db.transaction(async (tx) => {
      const config = await setup(tx, actor, true);
      const receipt = (
        await tx.query<{ requestHash: string; response: OwnStandup }>(
          `SELECT request_hash AS "requestHash",response
        FROM standup_command_receipt WHERE user_id=$1 AND idempotency_key=$2`,
          [actor, input.idempotencyKey],
        )
      ).rows[0];
      if (receipt) {
        if (receipt.requestHash !== hash) throw new DomainError("CONFLICT");
        return receipt.response;
      }
      // Recheck after taking the account lock: a request queued before noon may acquire it after noon.
      const stamp = clock();
      const day = dayState(input.date, stamp, config.startsOn, holidays);
      if (
        input.date !== day.today ||
        day.state !== "OPEN" ||
        config.createdDate >= input.date
      )
        throw new DomainError("STANDUP_CLOSED");
      const previous = await own(tx, actor, input.date);
      if (previous.version !== input.version) throw new DomainError("CONFLICT");
      const params = [
        actor,
        input.date,
        input.version + 1,
        input.todayPlan,
        input.previousWork,
        input.blockers,
        input.publish,
        stamp.toISOString(),
        randomUUID(),
      ];
      await tx.query(
        `INSERT INTO daily_standup(user_id,report_date,version,draft_plan,draft_previous,draft_blockers,
        published_plan,published_previous,published_blockers,published_at,created_at,updated_at,id)
        VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7 THEN $4 END,CASE WHEN $7 THEN $5 END,CASE WHEN $7 THEN $6 END,
          CASE WHEN $7 THEN $8::timestamptz END,$8,$8,$9)
        ON CONFLICT(user_id,report_date) DO UPDATE SET version=$3,draft_plan=$4,draft_previous=$5,draft_blockers=$6,
          published_plan=CASE WHEN $7 THEN $4 ELSE daily_standup.published_plan END,
          published_previous=CASE WHEN $7 THEN $5 ELSE daily_standup.published_previous END,
          published_blockers=CASE WHEN $7 THEN $6 ELSE daily_standup.published_blockers END,
          published_at=CASE WHEN $7 THEN $8::timestamptz ELSE daily_standup.published_at END,updated_at=$8`,
        params,
      );
      if (input.publish)
        await tx.query(
          `INSERT INTO kolab_standup_delivery
             (user_id,report_date,status,attempt_count,next_attempt_at,created_at,updated_at)
           VALUES($1,$2,'PENDING',0,$3,$3,$3)
           ON CONFLICT(user_id,report_date) DO UPDATE SET
             status='PENDING',attempt_count=0,next_attempt_at=EXCLUDED.next_attempt_at,
             lease_expires_at=NULL,completed_at=NULL,last_error_code=NULL,
             updated_at=EXCLUDED.updated_at
           WHERE kolab_standup_delivery.status NOT IN ('SENT','ALREADY_PRESENT')`,
          [actor, input.date, stamp.toISOString()],
        );
      const response = await own(tx, actor, input.date);
      await tx.query(
        `INSERT INTO standup_command_receipt(user_id,idempotency_key,request_hash,response,created_at)
        VALUES($1,$2,$3,$4::jsonb,$5)`,
        [
          actor,
          input.idempotencyKey,
          hash,
          JSON.stringify(response),
          stamp.toISOString(),
        ],
      );
      return response;
    });
  }
  async function claimReminder(
    actor: string,
    raw: unknown,
  ): Promise<{ show: boolean }> {
    const { date } = reminderInput.parse(raw);
    const holidays = await calendar(date);
    return db.transaction(async (tx) => {
      const config = await setup(tx, actor, true);
      const stamp = clock();
      const day = dayState(date, stamp, config.startsOn, holidays);
      if (
        date !== day.today ||
        day.state !== "OPEN" ||
        config.createdDate >= date ||
        (await own(tx, actor, date)).publishedAt
      )
        return { show: false };
      const result = await tx.query(
        `INSERT INTO standup_reminder(user_id,report_date,claimed_at) VALUES($1,$2,$3)
        ON CONFLICT DO NOTHING RETURNING user_id`,
        [actor, date, stamp.toISOString()],
      );
      return { show: result.rows.length === 1 };
    });
  }
  return { current, recap, save, claimReminder };
}

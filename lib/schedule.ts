import { getD1 } from "@/lib/db";
import { damascusClock, damascusDate } from "@/lib/time";

export const DEFAULT_WORK_DAYS = [6, 0, 1, 2, 3];
export const DEFAULT_WORK_START = "10:00";
export const DEFAULT_WORK_END = "18:00";
export const DEFAULT_REPORT_DEADLINE = "18:00";

export type CompanySchedule = {
  workStart: string;
  workEnd: string;
  workDays: number[];
  reportDeadline: string;
};

export type StaffSchedule = {
  userId: number;
  displayName: string;
  role: "editor" | "designer" | "account_manager";
  workStart: string | null;
  workEnd: string | null;
  workDays: number[] | null;
  effectiveWorkStart: string;
  effectiveWorkEnd: string;
  effectiveWorkDays: number[];
};

export type ReportWindow = {
  isLocked: boolean;
  lockReason:
    | "before_work_start"
    | "after_deadline"
    | "day_off"
    | "no_working_days"
    | null;
  nextOpenAt: string | null;
  reportDeadline: string;
  effectiveWorkStart: string;
  effectiveWorkEnd: string;
  effectiveWorkDays: number[];
};

type ScheduleRow = {
  userId: number;
  displayName: string;
  role: StaffSchedule["role"];
  workStart: string | null;
  workEnd: string | null;
  workDays: string | null;
};

export async function getCompanySchedule(
  database: D1Database = getD1(),
): Promise<CompanySchedule> {
  const rows = await database
    .prepare(
      `SELECT key,value
       FROM settings
       WHERE key IN ('work_start','work_end','working_days','report_deadline')`,
    )
    .all<{ key: string; value: string }>();
  const values = new Map((rows.results ?? []).map((row) => [row.key, row.value]));
  return {
    workStart: parseClock(values.get("work_start"), DEFAULT_WORK_START),
    workEnd: parseClock(values.get("work_end"), DEFAULT_WORK_END),
    workDays: parseWorkDays(values.get("working_days"), DEFAULT_WORK_DAYS),
    reportDeadline: parseClock(
      values.get("report_deadline"),
      DEFAULT_REPORT_DEADLINE,
    ),
  };
}

export async function listStaffSchedules(
  database: D1Database = getD1(),
  company?: CompanySchedule,
): Promise<StaffSchedule[]> {
  const companySchedule = company ?? (await getCompanySchedule(database));
  const result = await database
    .prepare(
      `SELECT
         u.id AS userId,
         u.display_name AS displayName,
         u.role,
         schedule.work_start AS workStart,
         schedule.work_end AS workEnd,
         schedule.work_days AS workDays
       FROM users u
       LEFT JOIN user_work_schedules schedule ON schedule.user_id=u.id
       WHERE u.is_active=1 AND u.role<>'admin'
       ORDER BY
         CASE u.role
           WHEN 'editor' THEN 1
           WHEN 'designer' THEN 2
           ELSE 3
         END,
         u.display_name`,
    )
    .all<ScheduleRow>();

  return (result.results ?? []).map((row) =>
    scheduleFromRow(row, companySchedule),
  );
}

export async function getStaffSchedule(
  userId: number,
  database: D1Database = getD1(),
  company?: CompanySchedule,
): Promise<StaffSchedule | null> {
  const companySchedule = company ?? (await getCompanySchedule(database));
  const row = await database
    .prepare(
      `SELECT
         u.id AS userId,
         u.display_name AS displayName,
         u.role,
         schedule.work_start AS workStart,
         schedule.work_end AS workEnd,
         schedule.work_days AS workDays
       FROM users u
       LEFT JOIN user_work_schedules schedule ON schedule.user_id=u.id
       WHERE u.id=? AND u.is_active=1 AND u.role<>'admin'
       LIMIT 1`,
    )
    .bind(userId)
    .first<ScheduleRow>();
  return row ? scheduleFromRow(row, companySchedule) : null;
}

export async function getReportWindow(
  userId: number,
  now = new Date(),
  database: D1Database = getD1(),
): Promise<ReportWindow> {
  const company = await getCompanySchedule(database);
  const staff = await getStaffSchedule(userId, database, company);
  if (!staff) {
    return {
      isLocked: true,
      lockReason: "no_working_days",
      nextOpenAt: null,
      reportDeadline: company.reportDeadline,
      effectiveWorkStart: company.workStart,
      effectiveWorkEnd: company.workEnd,
      effectiveWorkDays: [],
    };
  }
  return reportWindowForSchedule(staff, company.reportDeadline, now);
}

export function reportWindowForSchedule(
  schedule: Pick<
    StaffSchedule,
    "effectiveWorkStart" | "effectiveWorkEnd" | "effectiveWorkDays"
  >,
  reportDeadline: string,
  now = new Date(),
): ReportWindow {
  const clock = damascusClock(now);
  const currentMinutes = clock.hour * 60 + clock.minute;
  const startMinutes = clockMinutes(schedule.effectiveWorkStart);
  const deadlineMinutes = clockMinutes(reportDeadline);
  const worksToday = schedule.effectiveWorkDays.includes(clock.weekday);

  let lockReason: ReportWindow["lockReason"] = null;
  if (schedule.effectiveWorkDays.length === 0) {
    lockReason = "no_working_days";
  } else if (!worksToday) {
    lockReason = "day_off";
  } else if (currentMinutes < startMinutes) {
    lockReason = "before_work_start";
  } else if (currentMinutes >= deadlineMinutes) {
    lockReason = "after_deadline";
  }

  return {
    isLocked: lockReason !== null,
    lockReason,
    nextOpenAt:
      lockReason === null
        ? null
        : findNextOpenAt(
            damascusDate(now),
            clock.weekday,
            currentMinutes,
            schedule.effectiveWorkStart,
            schedule.effectiveWorkDays,
            lockReason,
          ),
    reportDeadline,
    effectiveWorkStart: schedule.effectiveWorkStart,
    effectiveWorkEnd: schedule.effectiveWorkEnd,
    effectiveWorkDays: [...schedule.effectiveWorkDays],
  };
}

export function parseWorkDays(
  value: string | null | undefined,
  fallback: number[] = DEFAULT_WORK_DAYS,
): number[] {
  if (value == null) return [...fallback];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [...fallback];
    return normalizeWorkDays(parsed);
  } catch {
    return [...fallback];
  }
}

export function normalizeWorkDays(value: unknown[]): number[] {
  return [
    ...new Set(
      value
        .map(Number)
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    ),
  ].sort((left, right) => left - right);
}

export function isClock(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  );
}

export function clockMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function parseClock(value: string | undefined, fallback: string): string {
  return isClock(value) ? value : fallback;
}

function scheduleFromRow(
  row: ScheduleRow,
  company: CompanySchedule,
): StaffSchedule {
  const workStart = isClock(row.workStart) ? row.workStart : null;
  const workEnd = isClock(row.workEnd) ? row.workEnd : null;
  const workDays =
    row.workDays == null ? null : parseWorkDays(row.workDays, company.workDays);
  return {
    userId: Number(row.userId),
    displayName: row.displayName,
    role: row.role,
    workStart,
    workEnd,
    workDays,
    effectiveWorkStart: workStart ?? company.workStart,
    effectiveWorkEnd: workEnd ?? company.workEnd,
    effectiveWorkDays: workDays ?? [...company.workDays],
  };
}

function findNextOpenAt(
  currentDate: string,
  currentWeekday: number,
  currentMinutes: number,
  workStart: string,
  workDays: number[],
  lockReason: NonNullable<ReportWindow["lockReason"]>,
): string | null {
  if (workDays.length === 0 || lockReason === "no_working_days") return null;
  const startMinutes = clockMinutes(workStart);
  if (
    lockReason === "before_work_start" &&
    workDays.includes(currentWeekday) &&
    currentMinutes < startMinutes
  ) {
    return damascusLocalToIso(currentDate, workStart);
  }

  for (let offset = 1; offset <= 7; offset += 1) {
    const weekday = (currentWeekday + offset) % 7;
    if (!workDays.includes(weekday)) continue;
    return damascusLocalToIso(shiftDate(currentDate, offset), workStart);
  }
  return null;
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function damascusLocalToIso(date: string, clock: string): string {
  return new Date(`${date}T${clock}:00+03:00`).toISOString();
}

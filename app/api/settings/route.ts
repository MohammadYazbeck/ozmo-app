import {
  AuthError,
  authErrorResponse,
  requireAdmin,
} from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import {
  clockMinutes,
  isClock,
  listStaffSchedules,
  normalizeWorkDays,
} from "@/lib/schedule";

const KEY_MAP = {
  reportDeadline: "report_deadline",
  firstReminder: "first_reminder",
  secondReminder: "second_reminder",
  escalationTime: "manager_escalation",
  workStart: "work_start",
  workEnd: "work_end",
  workDays: "working_days",
  sessionThreshold: "session_reel_threshold",
  sessionReminderTime: "session_daily_reminder_time",
  postThreshold: "low_post_threshold",
  draftThreshold: "low_draft_threshold",
  dailySummaryTime: "daily_summary_time",
  weeklySummaryDay: "weekly_summary_day",
  weeklySummaryTime: "weekly_summary_time",
  inventoryReady: "inventory_ready",
} as const;

type SettingsPayload = {
  reportDeadline: string;
  firstReminder: string;
  secondReminder: string;
  escalationTime: string;
  workStart: string;
  workEnd: string;
  workDays: number[];
  sessionThreshold: number;
  sessionReminderTime: string;
  postThreshold: number | null;
  draftThreshold: number | null;
  dailySummaryTime: string;
  weeklySummaryDay: number;
  weeklySummaryTime: string;
  inventoryReady: boolean;
  staffSchedules: StaffScheduleInput[];
};

type StaffScheduleInput = {
  userId: string | number;
  displayName?: string;
  role?: "editor" | "designer" | "account_manager" | "content_creator" | "content_manager";
  workStart: string | null;
  workEnd: string | null;
  workDays: number[] | null;
  effectiveWorkStart?: string;
  effectiveWorkEnd?: string;
  effectiveWorkDays?: number[];
};

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const rows = await getD1()
      .prepare("SELECT key,value FROM settings")
      .all<{ key: string; value: string }>();
    const values = new Map(rows.results.map((item) => [item.key, item.value]));
    const companySettings = fromStoredSettings(values);
    const staffSchedules = await listStaffSchedules(getD1(), {
      workStart: companySettings.workStart,
      workEnd: companySettings.workEnd,
      workDays: companySettings.workDays,
      reportDeadline: companySettings.reportDeadline,
    });
    return Response.json({
      settings: {
        ...companySettings,
        staffSchedules: staffSchedules.map(scheduleToResponse),
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const body = (await request.json().catch(() => null)) as Partial<SettingsPayload> | null;
    if (!body) {
      throw new AuthError(400, "INVALID_SETTINGS", "Settings are required.");
    }
    const settings = validateSettings(body);
    const database = getD1();
    const serialized: Record<keyof typeof KEY_MAP, string> = {
      reportDeadline: settings.reportDeadline,
      firstReminder: settings.firstReminder,
      secondReminder: settings.secondReminder,
      escalationTime: settings.escalationTime,
      workStart: settings.workStart,
      workEnd: settings.workEnd,
      workDays: JSON.stringify(settings.workDays),
      sessionThreshold: String(settings.sessionThreshold),
      sessionReminderTime: settings.sessionReminderTime,
      postThreshold:
        settings.postThreshold == null ? "" : String(settings.postThreshold),
      draftThreshold:
        settings.draftThreshold == null ? "" : String(settings.draftThreshold),
      dailySummaryTime: settings.dailySummaryTime,
      weeklySummaryDay: String(settings.weeklySummaryDay),
      weeklySummaryTime: settings.weeklySummaryTime,
      inventoryReady: String(settings.inventoryReady),
    };

    const staffSchedules = settings.staffSchedules;
    if (staffSchedules) {
      const validUsers = await database
        .prepare(
          `SELECT id FROM users
           WHERE is_active=1 AND role<>'admin'`,
        )
        .all<{ id: number }>();
      const validIds = new Set(
        (validUsers.results ?? []).map((row) => Number(row.id)),
      );
      if (staffSchedules.some((schedule) => !validIds.has(schedule.userId))) {
        throw new AuthError(
          400,
          "INVALID_STAFF_SCHEDULE",
          "Choose an active staff member for every schedule.",
        );
      }
    }

    const scheduleStatements = (staffSchedules ?? []).map((schedule) => {
      if (
        schedule.workStart == null &&
        schedule.workEnd == null &&
        schedule.workDays == null
      ) {
        return database
          .prepare("DELETE FROM user_work_schedules WHERE user_id=?")
          .bind(schedule.userId);
      }
      return database
        .prepare(
          `INSERT INTO user_work_schedules
             (user_id,work_start,work_end,work_days,updated_at)
           VALUES (?,?,?,?,CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET
             work_start=excluded.work_start,
             work_end=excluded.work_end,
             work_days=excluded.work_days,
             updated_at=CURRENT_TIMESTAMP`,
        )
        .bind(
          schedule.userId,
          schedule.workStart,
          schedule.workEnd,
          schedule.workDays == null
            ? null
            : JSON.stringify(schedule.workDays),
        );
    });

    await database.batch([
      ...Object.entries(KEY_MAP).map(([property, key]) =>
        database
          .prepare(
            `INSERT INTO settings (key,value,updated_at)
             VALUES (?,?,CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET
               value=excluded.value,updated_at=CURRENT_TIMESTAMP`,
          )
          .bind(key, serialized[property as keyof typeof KEY_MAP]),
      ),
      database
        .prepare(
          `UPDATE clients
           SET session_reel_threshold=?,updated_at=CURRENT_TIMESTAMP`,
        )
        .bind(settings.sessionThreshold),
      ...scheduleStatements,
    ]);

    const savedStaffSchedules = await listStaffSchedules(database, {
      workStart: settings.workStart,
      workEnd: settings.workEnd,
      workDays: settings.workDays,
      reportDeadline: settings.reportDeadline,
    });
    return Response.json({
      ok: true,
      settings: {
        ...settings,
        staffSchedules: savedStaffSchedules.map(scheduleToResponse),
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

function fromStoredSettings(
  values: Map<string, string>,
): Omit<SettingsPayload, "staffSchedules"> {
  return {
    reportDeadline: values.get(KEY_MAP.reportDeadline) ?? "18:00",
    firstReminder: values.get(KEY_MAP.firstReminder) ?? "17:15",
    secondReminder: values.get(KEY_MAP.secondReminder) ?? "17:25",
    escalationTime: values.get(KEY_MAP.escalationTime) ?? "18:00",
    workStart: values.get(KEY_MAP.workStart) ?? "10:00",
    workEnd: values.get(KEY_MAP.workEnd) ?? "18:00",
    workDays: parseWorkDays(values.get(KEY_MAP.workDays)),
    sessionThreshold: parseBounded(
      values.get(KEY_MAP.sessionThreshold),
      4,
      0,
      100,
    ),
    sessionReminderTime:
      values.get(KEY_MAP.sessionReminderTime) ?? "11:00",
    postThreshold: parseOptional(values.get(KEY_MAP.postThreshold)),
    draftThreshold: parseOptional(values.get(KEY_MAP.draftThreshold)),
    dailySummaryTime: values.get(KEY_MAP.dailySummaryTime) ?? "18:05",
    weeklySummaryDay: parseBounded(
      values.get(KEY_MAP.weeklySummaryDay),
      3,
      0,
      6,
    ),
    weeklySummaryTime: values.get(KEY_MAP.weeklySummaryTime) ?? "18:10",
    inventoryReady: values.get(KEY_MAP.inventoryReady) === "true",
  };
}

function validateSettings(
  body: Partial<SettingsPayload>,
): Omit<SettingsPayload, "staffSchedules"> & {
  staffSchedules?: Array<{
    userId: number;
    workStart: string | null;
    workEnd: string | null;
    workDays: number[] | null;
  }>;
} {
  const requiredTimes = [
    "reportDeadline",
    "firstReminder",
    "secondReminder",
    "escalationTime",
    "workStart",
    "workEnd",
    "sessionReminderTime",
    "dailySummaryTime",
    "weeklySummaryTime",
  ] as const;
  for (const key of requiredTimes) {
    if (!isClock(body[key])) {
      throw new AuthError(400, "INVALID_TIME", `Choose a valid time for ${key}.`);
    }
  }
  if (
    !Array.isArray(body.workDays) ||
    body.workDays.length < 1 ||
    body.workDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  ) {
    throw new AuthError(400, "INVALID_WORK_DAYS", "Choose at least one valid working day.");
  }
  const workDays = normalizeWorkDays(body.workDays);
  if (workDays.length !== new Set(body.workDays).size) {
    throw new AuthError(
      400,
      "INVALID_WORK_DAYS",
      "Working days must not contain duplicates.",
    );
  }
  const workStart = clockMinutes(body.workStart!);
  const workEnd = clockMinutes(body.workEnd!);
  const firstReminder = clockMinutes(body.firstReminder!);
  const secondReminder = clockMinutes(body.secondReminder!);
  const reportDeadline = clockMinutes(body.reportDeadline!);
  if (workStart >= workEnd) {
    throw new AuthError(
      400,
      "INVALID_WORK_HOURS",
      "Company work start must be earlier than work end.",
    );
  }
  if (workStart >= reportDeadline) {
    throw new AuthError(
      400,
      "INVALID_REPORT_WINDOW",
      "Report deadline must be later than company work start.",
    );
  }
  if (
    firstReminder >= secondReminder ||
    secondReminder >= reportDeadline
  ) {
    throw new AuthError(
      400,
      "INVALID_REPORT_TIMING",
      "Use this order: first reminder, second reminder, then report deadline.",
    );
  }
  const sessionThreshold = validateInteger(
    body.sessionThreshold,
    "session threshold",
    0,
    100,
  );
  const weeklySummaryDay = validateInteger(
    body.weeklySummaryDay,
    "weekly summary day",
    0,
    6,
  );
  const postThreshold = validateOptionalInteger(body.postThreshold, "post threshold");
  const draftThreshold = validateOptionalInteger(body.draftThreshold, "draft threshold");
  const staffSchedules =
    body.staffSchedules === undefined
      ? undefined
      : validateStaffSchedules(body.staffSchedules, {
          workStart: body.workStart!,
          workEnd: body.workEnd!,
          workDays,
          reportDeadline: body.reportDeadline!,
        });
  return {
    reportDeadline: body.reportDeadline!,
    firstReminder: body.firstReminder!,
    secondReminder: body.secondReminder!,
    escalationTime: body.escalationTime!,
    workStart: body.workStart!,
    workEnd: body.workEnd!,
    workDays,
    sessionThreshold,
    sessionReminderTime: body.sessionReminderTime!,
    postThreshold,
    draftThreshold,
    dailySummaryTime: body.dailySummaryTime!,
    weeklySummaryDay,
    weeklySummaryTime: body.weeklySummaryTime!,
    inventoryReady: body.inventoryReady === true,
    staffSchedules,
  };
}

function validateInteger(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw new AuthError(
      400,
      "INVALID_NUMBER",
      `${name} must be a whole number from ${min} to ${max}.`,
    );
  }
  return Number(value);
}

function validateOptionalInteger(value: unknown, name: string): number | null {
  if (value == null || value === "") return null;
  return validateInteger(value, name, 0, 10_000);
}

function parseWorkDays(value: string | undefined): number[] {
  try {
    const parsed = JSON.parse(value ?? "");
    return Array.isArray(parsed) ? parsed.map(Number).filter((day) => day >= 0 && day <= 6) : [6, 0, 1, 2, 3];
  } catch {
    return [6, 0, 1, 2, 3];
  }
}

function parseOptional(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  return parseBounded(value, 0, 0, 10_000);
}

function parseBounded(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : fallback;
}

function validateStaffSchedules(
  schedules: StaffScheduleInput[],
  company: {
    workStart: string;
    workEnd: string;
    workDays: number[];
    reportDeadline: string;
  },
) {
  if (!Array.isArray(schedules) || schedules.length > 500) {
    throw new AuthError(
      400,
      "INVALID_STAFF_SCHEDULE",
      "Staff schedules must be a valid list.",
    );
  }
  const seen = new Set<number>();
  return schedules.map((schedule) => {
    const userId = Number(schedule?.userId);
    if (!Number.isSafeInteger(userId) || userId < 1 || seen.has(userId)) {
      throw new AuthError(
        400,
        "INVALID_STAFF_SCHEDULE",
        "Each staff schedule needs one unique employee.",
      );
    }
    seen.add(userId);
    const workStart =
      schedule.workStart == null || schedule.workStart === ""
        ? null
        : schedule.workStart;
    const workEnd =
      schedule.workEnd == null || schedule.workEnd === ""
        ? null
        : schedule.workEnd;
    if (workStart != null && !isClock(workStart)) {
      throw new AuthError(
        400,
        "INVALID_STAFF_SCHEDULE",
        "Choose a valid staff work start time.",
      );
    }
    if (workEnd != null && !isClock(workEnd)) {
      throw new AuthError(
        400,
        "INVALID_STAFF_SCHEDULE",
        "Choose a valid staff work end time.",
      );
    }
    let workDays: number[] | null = null;
    if (schedule.workDays != null) {
      if (
        !Array.isArray(schedule.workDays) ||
        schedule.workDays.some(
          (day) => !Number.isInteger(day) || day < 0 || day > 6,
        )
      ) {
        throw new AuthError(
          400,
          "INVALID_STAFF_SCHEDULE",
          "Choose valid working days for each staff member.",
        );
      }
      workDays = normalizeWorkDays(schedule.workDays);
      if (workDays.length !== new Set(schedule.workDays).size) {
        throw new AuthError(
          400,
          "INVALID_STAFF_SCHEDULE",
          "A staff working day must not be repeated.",
        );
      }
    }

    const effectiveStart = workStart ?? company.workStart;
    const effectiveEnd = workEnd ?? company.workEnd;
    if (clockMinutes(effectiveStart) >= clockMinutes(effectiveEnd)) {
      throw new AuthError(
        400,
        "INVALID_STAFF_SCHEDULE",
        "Each staff work start must be earlier than their work end.",
      );
    }
    if (clockMinutes(effectiveStart) >= clockMinutes(company.reportDeadline)) {
      throw new AuthError(
        400,
        "INVALID_STAFF_SCHEDULE",
        "Each staff work start must be earlier than the report deadline.",
      );
    }
    return { userId, workStart, workEnd, workDays };
  });
}

function scheduleToResponse(schedule: Awaited<ReturnType<typeof listStaffSchedules>>[number]) {
  return {
    ...schedule,
    userId: String(schedule.userId),
  };
}

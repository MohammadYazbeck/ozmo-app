import { ensureDatabase, getD1 } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";
import {
  clockMinutes,
  getCompanySchedule,
  listStaffSchedules,
} from "@/lib/schedule";

export const OZMO_TIME_ZONE = "Asia/Damascus";

type NotificationKind =
  | "report_first_reminder"
  | "report_second_reminder"
  | "report_escalation"
  | "inventory_low"
  | "session_needed"
  | "session_upcoming"
  | "session_daily_reminder"
  | "session_cancelled"
  | "session_missed"
  | "manager_daily_summary"
  | "manager_weekly_summary"
  | "content_unavailable"
  | "browser_push_test"
  | "manual_team_message";

type NotificationInput = {
  recipientUserIds: number[];
  kind: NotificationKind;
  titleEn: string;
  titleAr: string;
  messageEn: string;
  messageAr: string;
  dedupeKey: string;
  relatedClientId?: number | null;
  dueAt?: string;
  suppressPush?: boolean;
};

export type NotificationRecord = {
  id: number;
  recipientUserId: number;
  kind: NotificationKind;
  channel: string;
  titleEn: string;
  titleAr: string;
  messageEn: string;
  messageAr: string;
  relatedClientId: number | null;
  dueAt: string | null;
  sentAt: string | null;
  readAt: string | null;
  status: string;
  createdAt: string;
};

export type SessionRecord = {
  id: number;
  clientId: number;
  clientName: string;
  createdByUserId: number;
  scheduledFor: string;
  status: "scheduled" | "completed" | "cancelled" | "missed";
  notes: string | null;
  reelsShot: number | null;
  reminderSentAt: string | null;
  missedAlertSentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TickCounts = {
  reportReminders: number;
  reportEscalations: number;
  inventoryAlerts: number;
  sessionAlerts: number;
  summaries: number;
  sessionsMarkedMissed: number;
};

type DamascusClock = {
  date: string;
  weekday: string;
  hour: number;
  minute: number;
  minuteOfDay: number;
};

let supportTablesReady = false;

async function ensureNotificationSupport() {
  await ensureDatabase();
  if (supportTablesReady) return;

  const db = getD1();
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_recipient_dedupe
       ON notifications(recipient_user_id, dedupe_key)`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS notification_states (
         key TEXT PRIMARY KEY,
         active INTEGER NOT NULL DEFAULT 0,
         generation INTEGER NOT NULL DEFAULT 0,
         last_value REAL,
         updated_at TEXT NOT NULL
       )`,
    )
    .run();
  supportTablesReady = true;
}

function rowChanges(result: { meta?: { changes?: number } }) {
  return Number(result.meta?.changes ?? 0);
}

function getDamascusClock(date = new Date()): DamascusClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: OZMO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: value("weekday"),
    hour,
    minute,
    minuteOfDay: hour * 60 + minute,
  };
}

function formatDamascusDateTime(iso: string, locale: "en" | "ar") {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SY" : "en-GB", {
    timeZone: OZMO_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

async function getSettingNumber(key: string, fallback: number) {
  const db = getD1();
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  if (!row) return fallback;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getOptionalSettingNumber(key: string) {
  const db = getD1();
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  if (!row?.value?.trim()) return null;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function getSettingString(key: string, fallback: string) {
  const db = getD1();
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value?.trim() || fallback;
}

async function getSettingBoolean(key: string, fallback: boolean) {
  const value = (
    await getSettingString(key, fallback ? "true" : "false")
  ).toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

async function getActiveUserIds(roles: string[]) {
  if (roles.length === 0) return [];
  const db = getD1();
  const placeholders = roles.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT id
       FROM users
       WHERE is_active = 1 AND role IN (${placeholders})`,
    )
    .bind(...roles)
    .all<{ id: number }>();
  return (result.results ?? []).map((row) => Number(row.id));
}

export async function enqueueNotification(input: NotificationInput) {
  await ensureNotificationSupport();
  const db = getD1();
  const createdAt = new Date().toISOString();
  let inserted = 0;
  for (const userId of [...new Set(input.recipientUserIds)]) {
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO notifications (
           recipient_user_id, kind, channel,
           title_en, title_ar, message_en, message_ar,
           related_client_id, dedupe_key, due_at, sent_at,
           read_at, status, created_at
         ) VALUES (?, ?, 'browser', ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'ready', ?)`,
      )
      .bind(
        userId,
        input.kind,
        input.titleEn,
        input.titleAr,
        input.messageEn,
        input.messageAr,
        input.relatedClientId ?? null,
        input.dedupeKey,
        input.dueAt ?? createdAt,
        createdAt,
        createdAt,
      )
      .run();
    const changes = rowChanges(result);
    inserted += changes;
    if (changes > 0 && !input.suppressPush) {
      try {
        await sendPushToUser(userId, {
          titleEn: input.titleEn,
          titleAr: input.titleAr,
          messageEn: input.messageEn,
          messageAr: input.messageAr,
          dedupeKey: input.dedupeKey,
          url: "/",
        });
      } catch (pushError) {
        console.error("OZMO could not dispatch a browser push", pushError);
      }
    }
  }
  return inserted;
}

export async function listNotifications(
  userId: number,
  options: { unreadOnly?: boolean; limit?: number } = {},
) {
  await ensureNotificationSupport();
  const db = getD1();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const unreadClause = options.unreadOnly ? "AND read_at IS NULL" : "";
  const result = await db
    .prepare(
      `SELECT
         id,
         recipient_user_id AS recipientUserId,
         kind,
         channel,
         title_en AS titleEn,
         title_ar AS titleAr,
         message_en AS messageEn,
         message_ar AS messageAr,
         related_client_id AS relatedClientId,
         due_at AS dueAt,
         sent_at AS sentAt,
         read_at AS readAt,
         status,
         created_at AS createdAt
       FROM notifications
       WHERE recipient_user_id = ? ${unreadClause}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(userId, limit)
    .all<NotificationRecord>();
  const unread = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM notifications
       WHERE recipient_user_id = ? AND read_at IS NULL`,
    )
    .bind(userId)
    .first<{ count: number }>();
  return {
    notifications: result.results ?? [],
    unreadCount: Number(unread?.count ?? 0),
  };
}

export async function markNotificationsRead(
  userId: number,
  options: { ids?: number[]; all?: boolean },
) {
  await ensureNotificationSupport();
  const db = getD1();
  const now = new Date().toISOString();
  if (options.all) {
    const result = await db
      .prepare(
        `UPDATE notifications
         SET read_at = ?, status = 'read'
         WHERE recipient_user_id = ? AND read_at IS NULL`,
      )
      .bind(now, userId)
      .run();
    return rowChanges(result);
  }

  const ids = [...new Set(options.ids ?? [])].slice(0, 100);
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `UPDATE notifications
       SET read_at = ?, status = 'read'
       WHERE recipient_user_id = ? AND id IN (${placeholders})`,
    )
    .bind(now, userId, ...ids)
    .run();
  return rowChanges(result);
}

async function processReportNotifications(clock: DamascusClock) {
  const counts = { reminders: 0, escalations: 0 };

  const firstStart = parseTime(
    await getSettingString("first_reminder", "17:15"),
    17 * 60 + 15,
  );
  const secondStart = parseTime(
    await getSettingString("second_reminder", "17:25"),
    17 * 60 + 25,
  );
  const reportDeadlineValue = await getSettingString(
    "report_deadline",
    "18:00",
  );
  const reportDeadline = parseTime(reportDeadlineValue, 18 * 60);
  const escalationTime = Math.max(
    reportDeadline,
    parseTime(
      await getSettingString("manager_escalation", "18:00"),
      18 * 60,
    ),
  );
  if (clock.minuteOfDay < firstStart) return counts;

  const db = getD1();
  const companySchedule = await getCompanySchedule(db);
  const weekday = weekdayNumber(clock.weekday);
  const scheduledStaff = (await listStaffSchedules(db, companySchedule)).filter(
    (user) =>
      user.effectiveWorkDays.includes(weekday) &&
      clock.minuteOfDay >= clockMinutes(user.effectiveWorkStart),
  );
  if (scheduledStaff.length === 0) return counts;
  const submittedResult = await db
    .prepare(
      `SELECT user_id AS userId
       FROM reports
       WHERE report_date=? AND status='submitted'`,
    )
    .bind(clock.date)
    .all<{ userId: number }>();
  const submittedIds = new Set(
    (submittedResult.results ?? []).map((row) => Number(row.userId)),
  );
  const missing = scheduledStaff.filter((user) => !submittedIds.has(user.userId));
  if (missing.length === 0) return counts;
  const deadlineEn = formatClock(reportDeadlineValue, "en");
  const deadlineAr = formatClock(reportDeadlineValue, "ar");

  if (clock.minuteOfDay >= firstStart && clock.minuteOfDay < secondStart) {
    for (const user of missing) {
      counts.reminders += await enqueueNotification({
        recipientUserIds: [user.userId],
        kind: "report_first_reminder",
        titleEn: "Daily report reminder",
        titleAr: "تذكير بالتقرير اليومي",
        messageEn: `Please submit your OZMO daily report by ${deadlineEn}.`,
        messageAr: `يرجى إرسال تقريرك اليومي في OZMO قبل الساعة ${deadlineAr}.`,
        dedupeKey: `report:first:${clock.date}`,
      });
    }
  } else if (
    clock.minuteOfDay >= secondStart &&
    clock.minuteOfDay < reportDeadline
  ) {
    for (const user of missing) {
      counts.reminders += await enqueueNotification({
        recipientUserIds: [user.userId],
        kind: "report_second_reminder",
        titleEn: "Your report is still missing",
        titleAr: "تقريرك لم يُرسل بعد",
        messageEn:
          `This is your second reminder. Please submit your report before ${deadlineEn}.`,
        messageAr:
          `هذا هو التذكير الثاني. يرجى إرسال تقريرك قبل الساعة ${deadlineAr}.`,
        dedupeKey: `report:second:${clock.date}`,
      });
    }
  } else if (clock.minuteOfDay >= escalationTime) {
    const adminIds = await getActiveUserIds(["admin"]);
    const namesEn = missing.map((user) => user.displayName).join(", ");
    const namesAr = missing.map((user) => user.displayName).join("، ");
    counts.escalations += await enqueueNotification({
      recipientUserIds: adminIds,
      kind: "report_escalation",
      titleEn: "Missing reports after the deadline",
      titleAr: "تقارير ناقصة بعد الموعد النهائي",
      messageEn: `${missing.length} report(s) are missing: ${namesEn}.`,
      messageAr: `عدد التقارير الناقصة: ${missing.length}. الموظفون: ${namesAr}.`,
      dedupeKey: `report:escalation:${clock.date}`,
    });
  }
  return counts;
}

type AlertState = {
  active: number;
  generation: number;
};

async function transitionAlertState(
  key: string,
  isActive: boolean,
  value: number,
  onActivated: (generation: number) => Promise<number>,
) {
  const db = getD1();
  const current = await db
    .prepare(
      "SELECT active, generation FROM notification_states WHERE key = ?",
    )
    .bind(key)
    .first<AlertState>();
  const wasActive = Boolean(current?.active);
  let inserted = 0;
  let generation = Number(current?.generation ?? 0);
  if (isActive && !wasActive) {
    generation += 1;
    inserted = await onActivated(generation);
  }
  await db
    .prepare(
      `INSERT INTO notification_states (
         key, active, generation, last_value, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         active = excluded.active,
         generation = excluded.generation,
         last_value = excluded.last_value,
         updated_at = excluded.updated_at`,
    )
    .bind(
      key,
      isActive ? 1 : 0,
      generation,
      value,
      new Date().toISOString(),
    )
    .run();
  return inserted;
}

async function processInventoryAlerts() {
  if (!(await getSettingBoolean("inventory_ready", false))) return 0;
  const db = getD1();
  const result = await db
    .prepare(
      `SELECT
         c.id AS clientId,
         c.name,
         COALESCE(c.session_reel_threshold, 4) AS sessionThreshold,
         COALESCE((
           SELECT ib.quantity FROM inventory_balances ib
           WHERE ib.client_id = c.id AND LOWER(ib.content_type) = 'reel'
         ), 0) AS reels,
         COALESCE((
           SELECT ib.quantity FROM inventory_balances ib
           WHERE ib.client_id = c.id AND LOWER(ib.content_type) = 'shot_reel'
         ), 0) AS shotReels,
         COALESCE((
           SELECT ib.quantity FROM inventory_balances ib
           WHERE ib.client_id = c.id AND LOWER(ib.content_type) = 'post'
         ), 0) AS posts,
         COALESCE((
           SELECT ib.quantity FROM inventory_balances ib
           WHERE ib.client_id = c.id AND LOWER(ib.content_type) = 'draft'
         ), 0) AS drafts
       FROM clients c
       WHERE c.is_active = 1
       ORDER BY c.name`,
    )
    .all<{
      clientId: number;
      name: string;
      sessionThreshold: number;
      reels: number;
      shotReels: number;
      posts: number;
      drafts: number;
    }>();
  const adminIds = await getActiveUserIds(["admin"]);
  const managerIds = await getActiveUserIds(["admin", "account_manager"]);
  const thresholds = {
    reel: await getSettingNumber("low_reel_threshold", 4),
    post: await getOptionalSettingNumber("low_post_threshold"),
    draft: await getOptionalSettingNumber("low_draft_threshold"),
  };
  let inserted = 0;

  for (const row of result.results ?? []) {
    const inventory = {
      reel: Number(row.reels),
      shotReel: Number(row.shotReels),
      post: Number(row.posts),
      draft: Number(row.drafts),
    };
    for (const contentType of ["reel", "post", "draft"] as const) {
      const value = inventory[contentType];
      const threshold = thresholds[contentType];
      if (threshold == null) {
        await transitionAlertState(
          `low:${row.clientId}:${contentType}`,
          false,
          value,
          async () => 0,
        );
        continue;
      }
      inserted += await transitionAlertState(
        `low:${row.clientId}:${contentType}`,
        value <= threshold,
        value,
        (generation) =>
          enqueueNotification({
            recipientUserIds: adminIds,
            kind: "inventory_low",
            titleEn: `Low ${contentType} inventory`,
            titleAr:
              contentType === "reel"
                ? "مخزون الريلز منخفض"
                : contentType === "post"
                  ? "مخزون البوستات منخفض"
                  : "مخزون المسودات منخفض",
            messageEn: `${row.name} has ${value} ${contentType}(s) left (threshold: ${threshold}).`,
            messageAr: `لدى ${row.name} عدد ${value} من ${
              contentType === "reel"
                ? "الريلز"
                : contentType === "post"
                  ? "البوستات"
                  : "المسودات"
            } (الحد: ${threshold}).`,
            relatedClientId: row.clientId,
            dedupeKey: `inventory:low:${row.clientId}:${contentType}:${generation}`,
          }),
      );
    }

    const sessionThreshold = Number(row.sessionThreshold ?? 4);
    const reelCoverage = inventory.reel + inventory.shotReel;
    inserted += await transitionAlertState(
      `session-needed:${row.clientId}`,
      reelCoverage <= sessionThreshold,
      reelCoverage,
      (generation) =>
        enqueueNotification({
          recipientUserIds: managerIds,
          kind: "session_needed",
          titleEn: "Content session needed",
          titleAr: "العميل بحاجة إلى جلسة محتوى",
          messageEn: `${row.name} has ${reelCoverage} Reel(s) covered (${inventory.reel} finished, ${inventory.shotReel} shot and waiting for editing). Please arrange a new session.`,
          messageAr: `لدى ${row.name} تغطية ${reelCoverage} ريلز (${inventory.reel} جاهزة و${inventory.shotReel} مصوّرة بانتظار المونتاج). يرجى ترتيب جلسة جديدة.`,
          relatedClientId: row.clientId,
          dedupeKey: `session:needed:${row.clientId}:${generation}`,
        }),
    );
  }
  return inserted;
}

async function insertSessionAuditTask(input: {
  userId: number;
  clientId: number;
  action:
    | "schedule"
    | "reschedule"
    | "complete"
    | "cancel"
    | "miss"
    | "delete";
  status: string;
  description: string;
  occurredOn?: string;
}) {
  const db = getD1();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO tasks (
         report_id, user_id, client_id, task_type, content_type,
         action, quantity, is_new_content, status, description,
         occurred_on, created_at, updated_at
       ) VALUES (NULL, ?, ?, 'session', NULL, ?, 0, 0, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.userId,
      input.clientId,
      input.action,
      input.status,
      input.description,
      input.occurredOn ?? getDamascusClock().date,
      now,
      now,
    )
    .run();
}

export async function notifySessionStatus(sessionId: number) {
  await ensureNotificationSupport();
  const db = getD1();
  const session = await db
    .prepare(
      `SELECT
         s.id,
         s.client_id AS clientId,
         c.name AS clientName,
         s.scheduled_for AS scheduledFor,
         s.status,
         s.updated_at AS updatedAt
       FROM sessions s
       JOIN clients c ON c.id = s.client_id
       WHERE s.id = ? AND c.is_active=1
         AND NOT EXISTS (
           SELECT 1 FROM session_deletions d WHERE d.session_id=s.id
         )`,
    )
    .bind(sessionId)
    .first<{
      id: number;
      clientId: number;
      clientName: string;
      scheduledFor: string;
      status: string;
      updatedAt: string;
    }>();
  if (!session || !["cancelled", "missed"].includes(session.status)) return 0;

  const recipientIds = await getActiveUserIds(["admin", "account_manager"]);
  const isCancelled = session.status === "cancelled";
  const inserted = await enqueueNotification({
    recipientUserIds: recipientIds,
    kind: isCancelled ? "session_cancelled" : "session_missed",
    titleEn: isCancelled ? "Session cancelled" : "Session missed",
    titleAr: isCancelled ? "تم إلغاء الجلسة" : "تم تفويت الجلسة",
    messageEn: `${session.clientName}'s session on ${formatDamascusDateTime(
      session.scheduledFor,
      "en",
    )} was ${session.status}.`,
    messageAr: `جلسة ${session.clientName} بتاريخ ${formatDamascusDateTime(
      session.scheduledFor,
      "ar",
    )} تم ${isCancelled ? "إلغاؤها" : "تفويتها"}.`,
    relatedClientId: session.clientId,
    dedupeKey: `session:${session.id}:${session.status}:${session.updatedAt}`,
  });
  await db
    .prepare(
      `UPDATE sessions
       SET missed_alert_sent_at = COALESCE(missed_alert_sent_at, ?)
       WHERE id = ?`,
    )
    .bind(new Date().toISOString(), session.id)
    .run();
  return inserted;
}

async function processSessionAlerts(now: Date, clock: DamascusClock) {
  const db = getD1();
  const reminderTime = parseTime(
    await getSettingString("session_daily_reminder_time", "11:00"),
    11 * 60,
  );
  if (clock.minuteOfDay < reminderTime) {
    return { alerts: 0, markedMissed: 0 };
  }
  const result = await db
    .prepare(
      `SELECT
         s.id,
         s.client_id AS clientId,
         c.name AS clientName,
         s.created_by_user_id AS createdByUserId,
         s.scheduled_for AS scheduledFor,
         s.status,
         s.reminder_sent_at AS reminderSentAt,
         s.missed_alert_sent_at AS missedAlertSentAt,
         s.updated_at AS updatedAt
       FROM sessions s
       JOIN clients c ON c.id = s.client_id
       JOIN users creator ON creator.id = s.created_by_user_id
       WHERE c.is_active=1
         AND s.status = 'scheduled'
         AND creator.is_active=1
         AND creator.role='account_manager'
         AND NOT EXISTS (
           SELECT 1 FROM session_deletions d WHERE d.session_id=s.id
         )`,
    )
    .all<{
      id: number;
      clientId: number;
      clientName: string;
      createdByUserId: number;
      scheduledFor: string;
      status: string;
      reminderSentAt: string | null;
      missedAlertSentAt: string | null;
      updatedAt: string;
    }>();

  let alerts = 0;
  for (const session of result.results ?? []) {
    const scheduledMs = new Date(session.scheduledFor).getTime();
    if (!Number.isFinite(scheduledMs)) continue;
    const isPastDue = scheduledMs < now.getTime();
    alerts += await enqueueNotification({
      recipientUserIds: [session.createdByUserId],
      kind: "session_daily_reminder",
      titleEn: isPastDue
        ? "Session still needs an update"
        : "Daily session reminder",
      titleAr: isPastDue
        ? "الجلسة ما زالت بحاجة إلى تحديث"
        : "تذكير يومي بالجلسة",
      messageEn: `${session.clientName}'s session is ${
        isPastDue ? "still marked as scheduled for" : "scheduled for"
      } ${formatDamascusDateTime(session.scheduledFor, "en")}. Update it manually after the session.`,
      messageAr: `جلسة ${session.clientName} ${
        isPastDue ? "ما زالت مسجلة كجلسة مجدولة بتاريخ" : "مجدولة بتاريخ"
      } ${formatDamascusDateTime(session.scheduledFor, "ar")}. يرجى تحديثها يدوياً بعد الجلسة.`,
      relatedClientId: session.clientId,
      dedupeKey: `session:daily:${session.id}:${clock.date}`,
    });
  }
  return { alerts, markedMissed: 0 };
}

function dateShift(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

async function getManagerSummary(
  startDate: string,
  endDate: string,
) {
  const db = getD1();
  const companySchedule = await getCompanySchedule(db);
  const staffSchedules = await listStaffSchedules(db, companySchedule);
  let expectedReports = 0;
  for (
    let date = startDate;
    date <= endDate;
    date = dateShift(date, 1)
  ) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    expectedReports += staffSchedules.filter((schedule) =>
      schedule.effectiveWorkDays.includes(weekday),
    ).length;
  }
  const reports = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM reports
       WHERE status = 'submitted' AND report_date BETWEEN ? AND ?`,
    )
    .bind(startDate, endDate)
    .first<{ count: number }>();
  const events = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE
           WHEN content_type='shot_reel'
             AND event_type LIKE 'session_shot_reels:%' AND delta>0
           THEN delta ELSE 0 END), 0) AS shot,
         COALESCE(SUM(CASE
           WHEN event_type IN ('reel_new','post_new','story_new','draft_created')
             AND delta>0
           THEN delta ELSE 0 END), 0) AS produced,
         COALESCE(SUM(CASE
           WHEN event_type IN ('publish_reel','publish_post','publish_story') AND delta<0
           THEN -delta ELSE 0 END), 0) AS published
       FROM inventory_events
       WHERE occurred_on BETWEEN ? AND ?`,
    )
    .bind(startDate, endDate)
    .first<{ shot: number; produced: number; published: number }>();
  return {
    staff: expectedReports,
    reports: Number(reports?.count ?? 0),
    shot: Number(events?.shot ?? 0),
    produced: Number(events?.produced ?? 0),
    published: Number(events?.published ?? 0),
  };
}

function parseTime(value: string, fallback: number) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return hour * 60 + minute;
}

async function processManagerSummaries(clock: DamascusClock) {
  let inserted = 0;
  const adminIds = await getActiveUserIds(["admin"]);
  if (adminIds.length === 0) return inserted;
  const reportDeadline = parseTime(
    await getSettingString("report_deadline", "18:00"),
    18 * 60,
  );
  const dailyAt = Math.max(
    reportDeadline,
    parseTime(
      await getSettingString("daily_summary_time", "18:05"),
      18 * 60 + 5,
    ),
  );
  if (clock.minuteOfDay >= dailyAt) {
    const summary = await getManagerSummary(clock.date, clock.date);
    if (summary.staff > 0) {
      inserted += await enqueueNotification({
        recipientUserIds: adminIds,
        kind: "manager_daily_summary",
        titleEn: "OZMO daily summary",
        titleAr: "ملخص OZMO اليومي",
        messageEn: `${summary.reports}/${summary.staff} reports submitted. Shot reels added: ${summary.shot}; finished content added: ${summary.produced}; published: ${summary.published}.`,
        messageAr: `تم إرسال ${summary.reports} من أصل ${summary.staff} تقارير. الريلز المصوّرة المضافة: ${summary.shot}؛ المحتوى الجاهز المضاف: ${summary.produced}؛ المنشور: ${summary.published}.`,
        dedupeKey: `summary:daily:${clock.date}`,
      });
    }
  }

  const weeklyAt = Math.max(
    reportDeadline,
    parseTime(
      await getSettingString("weekly_summary_time", "18:10"),
      18 * 60 + 10,
    ),
  );
  const weeklyDay = await getSettingNumber("weekly_summary_day", 3);
  const weekdayNumber: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  if (
    weekdayNumber[clock.weekday] === weeklyDay &&
    clock.minuteOfDay >= weeklyAt
  ) {
    const startDate = dateShift(clock.date, -4);
    const summary = await getManagerSummary(startDate, clock.date);
    inserted += await enqueueNotification({
      recipientUserIds: adminIds,
      kind: "manager_weekly_summary",
      titleEn: "OZMO weekly summary",
      titleAr: "ملخص OZMO الأسبوعي",
      messageEn: `${summary.reports} reports submitted from ${startDate} to ${clock.date}. Shot reels added: ${summary.shot}; finished content added: ${summary.produced}; published: ${summary.published}.`,
      messageAr: `تم إرسال ${summary.reports} تقريراً من ${startDate} إلى ${clock.date}. الريلز المصوّرة المضافة: ${summary.shot}؛ المحتوى الجاهز المضاف: ${summary.produced}؛ المنشور: ${summary.published}.`,
      dedupeKey: `summary:weekly:${clock.date}`,
    });
  }
  return inserted;
}

function weekdayNumber(weekday: string) {
  const days: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return days[weekday] ?? -1;
}

function formatClock(value: string, locale: "en" | "ar") {
  const [hour, minute] = value.split(":").map(Number);
  const suffix =
    hour >= 12
      ? locale === "ar"
        ? "مساءً"
        : "PM"
      : locale === "ar"
        ? "صباحاً"
        : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export async function runNotificationTick(date = new Date()): Promise<TickCounts> {
  await ensureNotificationSupport();
  const clock = getDamascusClock(date);
  const reports = await processReportNotifications(clock);
  const inventoryAlerts = await processInventoryAlerts();
  const sessions = await processSessionAlerts(date, clock);
  const summaries = await processManagerSummaries(clock);
  return {
    reportReminders: reports.reminders,
    reportEscalations: reports.escalations,
    inventoryAlerts,
    sessionAlerts: sessions.alerts,
    summaries,
    sessionsMarkedMissed: sessions.markedMissed,
  };
}

export async function auditSessionChange(input: {
  userId: number;
  clientId: number;
  action:
    | "schedule"
    | "reschedule"
    | "complete"
    | "cancel"
    | "miss"
    | "delete";
  status: string;
  description: string;
  occurredOn?: string;
}) {
  await ensureNotificationSupport();
  return insertSessionAuditTask(input);
}

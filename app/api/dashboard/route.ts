import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import { getCompanySchedule, listStaffSchedules } from "@/lib/schedule";
import { damascusDate, isoWeekDates } from "@/lib/time";

type ClientRow = {
  id: number;
  ozmo_client_id: string;
  name: string;
  session_reel_threshold: number;
  remaining_payment_cents: number;
  remaining_payment_currency: string;
  updated_at: string;
  reel_count: number;
  shot_reel_count: number;
  post_count: number;
  draft_count: number;
};

type StaffStatusRow = {
  user_id: number;
  display_name: string;
  role: "editor" | "designer" | "account_manager";
  report_status: "submitted" | "draft" | null;
  submitted_at: string | null;
};

type ActivityRow = {
  id: number;
  created_at: string;
  display_name: string;
  role: "editor" | "designer" | "account_manager";
  client_name: string | null;
  task_type: string;
  description: string;
  content_type: "reel" | "post" | "draft" | null;
  quantity: number;
  status: string;
};

type SessionRow = {
  id: number;
  client_id: number;
  client_name: string;
  scheduled_for: string;
  status: "scheduled" | "completed" | "cancelled" | "missed";
  notes: string;
  reels_shot: number | null;
  creator_name: string;
};

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const database = getD1();
    const today = damascusDate();
    const monthStart = `${today.slice(0, 7)}-01`;
    const weekDates = isoWeekDates();
    const companySchedule = await getCompanySchedule(database);
    const staffSchedules = await listStaffSchedules(database, companySchedule);
    const todayWeekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const workingStaffIds = new Set(
      staffSchedules
        .filter((schedule) =>
          schedule.effectiveWorkDays.includes(todayWeekday),
        )
        .map((schedule) => schedule.userId),
    );

    const [
      statusRows,
      clientRows,
      settingsRows,
      monthly,
      weeklyRows,
      activityRows,
      sessionRows,
    ] = await Promise.all([
      database
        .prepare(
          `SELECT
             u.id AS user_id,u.display_name,u.role,
             r.status AS report_status,r.submitted_at
           FROM users u
           LEFT JOIN reports r
             ON r.user_id=u.id AND r.report_date=?
           WHERE u.is_active=1 AND u.role<>'admin'
           ORDER BY
             CASE u.role
               WHEN 'editor' THEN 1
               WHEN 'designer' THEN 2
               ELSE 3
             END,
             u.id`,
        )
        .bind(today)
        .all<StaffStatusRow>(),
      database
        .prepare(
          `SELECT
             c.id,c.ozmo_client_id,c.name,c.session_reel_threshold,
             c.remaining_payment_cents,c.remaining_payment_currency,c.updated_at,
             COALESCE(MAX(CASE WHEN b.content_type='reel' THEN b.quantity END),0) AS reel_count,
             COALESCE(MAX(CASE WHEN b.content_type='shot_reel' THEN b.quantity END),0) AS shot_reel_count,
             COALESCE(MAX(CASE WHEN b.content_type='post' THEN b.quantity END),0) AS post_count,
             COALESCE(MAX(CASE WHEN b.content_type='draft' THEN b.quantity END),0) AS draft_count
           FROM clients c
           LEFT JOIN inventory_balances b ON b.client_id=c.id
           WHERE c.is_active=1
           GROUP BY c.id,c.ozmo_client_id,c.name,c.session_reel_threshold,
                    c.remaining_payment_cents,c.remaining_payment_currency,c.updated_at
           ORDER BY c.id`,
        )
        .all<ClientRow>(),
      database
        .prepare(
          `SELECT key,value FROM settings
           WHERE key IN ('inventory_ready','low_post_threshold','low_draft_threshold')`,
        )
        .all<{ key: string; value: string }>(),
      database
        .prepare(
          `SELECT
             COALESCE(SUM(CASE
               WHEN event_type IN ('reel_new','post_new','draft_created')
               THEN delta ELSE 0 END),0) AS produced,
             COALESCE(SUM(CASE
               WHEN event_type IN ('publish_reel','publish_post')
               THEN -delta ELSE 0 END),0) AS published
           FROM inventory_events
           WHERE occurred_on>=?`,
        )
        .bind(monthStart)
        .first<{ produced: number; published: number }>(),
      database
        .prepare(
          `SELECT
             occurred_on,
             COALESCE(SUM(CASE
               WHEN event_type IN ('reel_new','post_new','draft_created')
               THEN delta ELSE 0 END),0) AS produced,
             COALESCE(SUM(CASE
               WHEN event_type IN ('publish_reel','publish_post')
               THEN -delta ELSE 0 END),0) AS published
           FROM inventory_events
           WHERE occurred_on>=? AND occurred_on<=?
           GROUP BY occurred_on`,
        )
        .bind(weekDates[0], weekDates[weekDates.length - 1])
        .all<{ occurred_on: string; produced: number; published: number }>(),
      database
        .prepare(
          `SELECT
             t.id,t.created_at,u.display_name,u.role,c.name AS client_name,
             t.task_type,t.description,t.content_type,t.quantity,t.status
           FROM tasks t
           JOIN users u ON u.id=t.user_id
           LEFT JOIN clients c ON c.id=t.client_id
           LEFT JOIN reports r ON r.id=t.report_id
           WHERE (t.report_id IS NULL OR r.status='submitted')
             AND NOT EXISTS (
               SELECT 1 FROM activity_log_hides h
               WHERE h.source_type='task' AND h.source_id=t.id
             )
           ORDER BY t.created_at DESC,t.id DESC
           LIMIT 12`,
        )
        .all<ActivityRow>(),
      database
        .prepare(
          `SELECT
             s.id,s.client_id,c.name AS client_name,s.scheduled_for,
             s.status,s.notes,s.reels_shot,u.display_name AS creator_name
           FROM sessions s
           JOIN clients c ON c.id=s.client_id
           JOIN users u ON u.id=s.created_by_user_id
           WHERE c.is_active=1 AND s.status='scheduled'
             AND NOT EXISTS (
               SELECT 1 FROM session_deletions d WHERE d.session_id=s.id
             )
           ORDER BY s.scheduled_for
           LIMIT 8`,
        )
        .all<SessionRow>(),
    ]);

    const settingMap = new Map(
      settingsRows.results.map((item) => [item.key, item.value]),
    );
    const inventoryReady = settingMap.get("inventory_ready") === "true";
    const postThreshold = optionalNumber(settingMap.get("low_post_threshold"));
    const draftThreshold = optionalNumber(settingMap.get("low_draft_threshold"));
    const clients = clientRows.results.map((client) => ({
      id: String(client.id),
      ozmoClientId: client.ozmo_client_id,
      name: client.name,
      reelCount: Number(client.reel_count),
      shotReelCount: Number(client.shot_reel_count),
      postCount: Number(client.post_count),
      draftCount: Number(client.draft_count),
      sessionThreshold: client.session_reel_threshold,
      remainingPaymentCents: Number(client.remaining_payment_cents ?? 0),
      remainingPaymentCurrency: client.remaining_payment_currency || "USD",
      postThreshold,
      draftThreshold,
      needsSession:
        inventoryReady &&
        Number(client.reel_count) + Number(client.shot_reel_count) <=
          client.session_reel_threshold,
      updatedAt: client.updated_at,
    }));

    const workingStatusRows = statusRows.results.filter((item) =>
      workingStaffIds.has(Number(item.user_id)),
    );
    const submittedCount = workingStatusRows.filter(
      (item) => item.report_status === "submitted",
    ).length;
    const totalStaff = workingStatusRows.length;
    const weeklyMap = new Map(
      weeklyRows.results.map((item) => [item.occurred_on, item]),
    );
    const weeklyProduction = weekDates.map((date) => {
      const row = weeklyMap.get(date);
      return {
        label: new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(
          new Date(`${date}T12:00:00Z`),
        ),
        produced: Number(row?.produced ?? 0),
        published: Number(row?.published ?? 0),
      };
    });

    return Response.json({
      dashboard: {
        today,
        reportDeadline: companySchedule.reportDeadline,
        workStart: companySchedule.workStart,
        workEnd: companySchedule.workEnd,
        workDays: companySchedule.workDays,
        totalStaff,
        submittedCount,
        missingCount: totalStaff - submittedCount,
        completionRate:
          totalStaff > 0 ? Math.round((submittedCount / totalStaff) * 100) : 100,
        reelsAvailable: clients.reduce((sum, client) => sum + client.reelCount, 0),
        shotReelsWaiting: clients.reduce(
          (sum, client) => sum + client.shotReelCount,
          0,
        ),
        postsAvailable: clients.reduce((sum, client) => sum + client.postCount, 0),
        draftsAvailable: clients.reduce((sum, client) => sum + client.draftCount, 0),
        contentProducedThisMonth: Number(monthly?.produced ?? 0),
        contentPublishedThisMonth: Number(monthly?.published ?? 0),
        inventoryReady,
        reportStatuses: workingStatusRows.map((item) => ({
          userId: String(item.user_id),
          displayName: item.display_name,
          role: item.role,
          status:
            item.report_status === "submitted"
              ? "submitted"
              : item.report_status === "draft"
                ? "draft"
                : "missing",
          submittedAt: item.submitted_at,
        })),
        offToday: staffSchedules
          .filter(
            (schedule) =>
              !schedule.effectiveWorkDays.includes(todayWeekday),
          )
          .map((schedule) => ({
            userId: String(schedule.userId),
            displayName: schedule.displayName,
            role: schedule.role,
          })),
        clients,
        recentActivity: activityRows.results.map(activityToItem),
        weeklyProduction,
        upcomingSessions: sessionRows.results.map((session) => ({
          id: String(session.id),
          clientId: String(session.client_id),
          clientName: session.client_name,
          scheduledAt: session.scheduled_for,
          status: session.status,
          notes: session.notes,
          reelsShot: session.reels_shot,
          createdByName: session.creator_name,
        })),
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

function activityToItem(item: ActivityRow) {
  let delta = 0;
  if (
    (item.task_type === "reel_new" || item.task_type === "post_new") &&
    item.status === "completed"
  ) {
    delta = item.quantity;
  } else if (
    item.task_type === "publish_reel" ||
    item.task_type === "publish_post"
  ) {
    delta = -item.quantity;
  } else if (item.task_type === "draft_created") {
    delta = item.quantity;
  }
  return {
    id: `task-${item.id}`,
    date: item.created_at,
    actorName: item.display_name,
    actorRole: item.role,
    clientName:
      item.client_name ?? (item.task_type === "other" ? "Other" : null),
    actionType: item.task_type,
    notes: readableTaskNotes(
      item.task_type,
      item.description,
      item.quantity,
    ),
    reelDelta: item.content_type === "reel" ? delta : 0,
    shotReelDelta: taskShotReelDelta(item),
    postDelta: item.content_type === "post" ? delta : 0,
    draftDelta: item.content_type === "draft" ? delta : 0,
  };
}

function taskShotReelDelta(item: ActivityRow) {
  if (item.task_type === "session_completed") return item.quantity;
  if (item.task_type === "reel_new" && item.status === "completed") {
    return -item.quantity;
  }
  if (item.task_type !== "session" || !item.description.trim().startsWith("{")) {
    return 0;
  }
  try {
    const audit = JSON.parse(item.description) as {
      event?: string;
      previous?: { status?: string; reelsShot?: number | null };
      current?: { status?: string; reelsShot?: number | null };
    };
    if (audit.event !== "session_updated" || audit.current?.status !== "completed") {
      return 0;
    }
    const current = Number(audit.current.reelsShot ?? 0);
    const previous =
      audit.previous?.status === "completed"
        ? Number(audit.previous.reelsShot ?? 0)
        : 0;
    return current - previous;
  } catch {
    return 0;
  }
}

function readableTaskNotes(
  taskType: string,
  description: string,
  quantity: number,
) {
  if (taskType === "session_completed" && !description.trim()) {
    return `${quantity} reel${quantity === 1 ? "" : "s"} shot`;
  }
  if (taskType !== "session" || !description.trim().startsWith("{")) {
    return description;
  }
  try {
    const audit = JSON.parse(description) as {
      event?: string;
      reason?: string;
      current?: { status?: string; reelsShot?: number | null };
      session?: { status?: string; reelsShot?: number | null };
    };
    if (audit.event === "session_removed") {
      return audit.reason
        ? `Session removed · ${audit.reason}`
        : "Session removed from the planner";
    }
    if (audit.event === "session_updated" && audit.current?.status) {
      const reels =
        audit.current.status === "completed" &&
        Number.isSafeInteger(audit.current.reelsShot)
          ? ` · ${audit.current.reelsShot} reel${
              audit.current.reelsShot === 1 ? "" : "s"
            } shot`
          : "";
      return `Session marked ${audit.current.status}${reels}`;
    }
  } catch {
    // Older free-text session records remain readable as entered.
  }
  return "Session details updated";
}

function optionalNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

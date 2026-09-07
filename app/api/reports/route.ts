import {
  AuthError,
  authErrorResponse,
  requireUser,
} from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import { notifySessionStatus } from "@/lib/notifications";
import { getReportWindow } from "@/lib/schedule";
import {
  damascusDate,
  isAfterDeadline,
  localDamascusDateTimeToIso,
} from "@/lib/time";

type RawTask = {
  id?: string | number;
  clientId?: string | number;
  actionType?: string;
  status?: string;
  quantity?: number;
  notes?: string;
  reelsShot?: number;
  sessionAt?: string;
  sessionId?: string | number;
};

type NormalizedTask = {
  clientId: number | null;
  clientName: string | null;
  actionType: string;
  status: "completed" | "in_progress";
  quantity: number;
  notes: string;
  contentType: "reel" | "post" | "story" | "draft" | null;
  action: string | null;
  isNewContent: boolean | null;
  inventoryDelta: number;
  shotReelDelta: number;
  sessionAt: string | null;
  sessionId: number | null;
  reelsShot: number | null;
};

type ClientRow = {
  id: number;
  name: string;
};

type ReportRow = {
  id: number;
  report_date: string;
  status: "draft" | "submitted";
  submitted_at: string | null;
  correction_used: number;
};

type TaskRow = {
  id: number;
  client_id: number | null;
  client_name: string | null;
  task_type: string;
  action: string | null;
  status: "completed" | "in_progress";
  quantity: number;
  description: string;
  created_at: string;
  is_correction: number;
};

const OTHER_CLIENT_ID = "__other__";
const AGENCY_ACTIONS = new Set([
  "competitor_analysis",
  "agency_report",
  "agency_observation",
]);

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    if (user.role === "admin") {
      throw new AuthError(
        403,
        "STAFF_REPORT_ONLY",
        "Administrators use the company dashboard instead of a staff report.",
      );
    }

    await ensureDatabase();
    const database = getD1();
    const reportDate = damascusDate();
    const reportWindow = await getReportWindow(user.id, new Date(), database);
    const report = await database
      .prepare(
        `SELECT
           r.id,r.report_date,r.status,r.submitted_at,
           CASE WHEN rc.report_id IS NULL THEN 0 ELSE 1 END AS correction_used
         FROM reports r
         LEFT JOIN report_corrections rc ON rc.report_id=r.id
         WHERE r.user_id=? AND r.report_date=?
         LIMIT 1`,
      )
      .bind(user.id, reportDate)
      .first<ReportRow>();

    if (!report) {
      return Response.json({
        report: {
          reportDate,
          status: "not_started",
           submittedAt: null,
           isLate: false,
          editTokensRemaining: 1,
          canCorrect: false,
          ...reportWindow,
          tasks: [],
        },
      });
    }

    const tasks = await database
      .prepare(
        `SELECT
           t.id,t.client_id,c.name AS client_name,t.task_type,t.action,t.status,
           t.quantity,t.description,t.created_at,t.is_correction
         FROM tasks t
         LEFT JOIN clients c ON c.id=t.client_id
         WHERE t.report_id=?
         ORDER BY t.id`,
      )
      .bind(report.id)
      .all<TaskRow>();

    return Response.json({
      report: {
        id: String(report.id),
        reportDate: report.report_date,
        status: report.status,
        submittedAt: report.submitted_at,
        isLate: report.submitted_at
          ? isAfterDeadline(
              new Date(report.submitted_at),
              reportWindow.reportDeadline,
            )
          : false,
        editTokensRemaining: report.correction_used ? 0 : 1,
        canCorrect:
          report.status === "submitted" &&
          !reportWindow.isLocked &&
          !report.correction_used,
        ...reportWindow,
        isLocked: report.status === "submitted" || reportWindow.isLocked,
        lockReason:
          report.status === "submitted"
            ? "submitted"
            : reportWindow.lockReason,
        tasks: tasks.results.map((task) => ({
          id: String(task.id),
          clientId:
            task.client_id == null && task.task_type === "other"
              ? OTHER_CLIENT_ID
              : task.client_id == null
                ? ""
                : String(task.client_id),
          clientName:
            task.client_id == null && task.task_type === "other"
              ? "Other"
              : task.client_name,
          actionType: task.task_type,
          status: task.status,
          quantity: task.quantity,
          notes: task.description,
          reelsShot:
            task.task_type === "session_completed"
              ? task.quantity
              : undefined,
          sessionAt:
            task.task_type === "session_scheduled"
              ? isoToDamascusLocal(task.action)
              : undefined,
          sessionId:
            task.task_type.startsWith("session_") &&
            task.task_type !== "session_scheduled"
              ? task.action ?? undefined
              : undefined,
          createdAt: task.created_at,
          isCorrection: Boolean(task.is_correction),
        })),
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (user.role === "admin") {
      throw new AuthError(
        403,
        "STAFF_REPORT_ONLY",
        "Administrators use the company dashboard instead of a staff report.",
      );
    }

    await ensureDatabase();
    const database = getD1();
    const reportWindow = await getReportWindow(user.id, new Date(), database);
    if (reportWindow.isLocked) {
      throw new AuthError(
        423,
        "REPORT_WINDOW_LOCKED",
        reportWindowMessage(reportWindow.lockReason, reportWindow.nextOpenAt),
      );
    }
    const body = (await request.json().catch(() => null)) as {
      action?: "save" | "submit" | "correct";
      tasks?: RawTask[];
    } | null;
    if (!body || !["save", "submit", "correct"].includes(body.action ?? "")) {
      throw new AuthError(
        400,
        "INVALID_ACTION",
        "Choose Save draft, Submit, or use the correction token.",
      );
    }
    if (!Array.isArray(body.tasks) || body.tasks.length < 1 || body.tasks.length > 50) {
      throw new AuthError(
        400,
        "INVALID_TASKS",
        "A daily report needs between 1 and 50 tasks.",
      );
    }

    const reportDate = damascusDate();
    const current = await database
      .prepare(
        `SELECT
           r.id,r.report_date,r.status,r.submitted_at,
           CASE WHEN rc.report_id IS NULL THEN 0 ELSE 1 END AS correction_used
         FROM reports r
         LEFT JOIN report_corrections rc ON rc.report_id=r.id
         WHERE r.user_id=? AND r.report_date=?
         LIMIT 1`,
      )
      .bind(user.id, reportDate)
      .first<ReportRow>();
    if (current?.status === "submitted" && body.action !== "correct") {
      throw new AuthError(
        409,
        "REPORT_ALREADY_SUBMITTED",
        "Today’s report has already been submitted and is locked.",
      );
    }
    if (body.action === "correct" && current?.status !== "submitted") {
      throw new AuthError(
        409,
        "REPORT_NOT_SUBMITTED",
        "Submit today’s report before using its one correction token.",
      );
    }
    if (body.action === "correct" && current?.correction_used) {
      throw new AuthError(
        409,
        "CORRECTION_TOKEN_USED",
        "Today’s one report correction token has already been used.",
      );
    }

    const clientRows = await database
      .prepare("SELECT id,name FROM clients WHERE is_active=1")
      .all<ClientRow>();
    const clientMap = new Map(clientRows.results.map((client) => [client.id, client]));
    const tasks = await normalizeTasks(
      body.tasks,
      user.role,
      clientMap,
      database,
    );
    const summary = tasks.map((task) => task.notes).join("\n").slice(0, 4_000);

    if (body.action === "correct" && current) {
      await validateConsumption(tasks, database, {
        id: user.id,
        displayName: user.displayName,
      });
      const statements: D1PreparedStatement[] = [
        database
          .prepare(
            `INSERT INTO report_corrections
               (report_id,corrected_by_user_id)
             VALUES (?,?)`,
          )
          .bind(current.id, user.id),
      ];
      const sessionAlertIds = new Set<number>();
      for (const task of tasks) {
        appendCommittedTaskStatements(statements, database, task, {
          reportId: current.id,
          userId: user.id,
          reportDate,
          isCorrection: true,
          sessionAlertIds,
        });
      }
      try {
        await database.batch(statements);
      } catch (batchError) {
        const message = String(batchError);
        if (
          message.includes("report_corrections") ||
          message.includes("UNIQUE")
        ) {
          throw new AuthError(
            409,
            "CORRECTION_TOKEN_USED",
            "Today’s one report correction token has already been used.",
          );
        }
        if (
          message.includes("inventory_balances_nonnegative") ||
          message.includes("CHECK constraint")
        ) {
          throw new AuthError(
            409,
            "CONTENT_UNAVAILABLE",
            "The selected content is no longer available. The correction was not added.",
          );
        }
        throw batchError;
      }
      await sendSessionAlerts(sessionAlertIds);
      return Response.json({
        ok: true,
        status: "submitted",
        corrected: true,
        reportId: String(current.id),
        editTokensRemaining: 0,
      });
    }

    let reportId = current?.id;
    if (!reportId) {
      const inserted = await database
        .prepare(
          `INSERT INTO reports (user_id,report_date,status,summary)
           VALUES (?,?,'draft',?)`,
        )
        .bind(user.id, reportDate, summary)
        .run();
      reportId = Number(inserted.meta.last_row_id);
    }
    if (!reportId) {
      throw new Error("Could not create the daily report.");
    }

    if (body.action === "save") {
      const statements: D1PreparedStatement[] = [
        database
          .prepare(
            `UPDATE reports SET summary=?,updated_at=CURRENT_TIMESTAMP
             WHERE id=? AND status='draft'`,
          )
          .bind(summary, reportId),
        database
          .prepare(
            `DELETE FROM tasks
             WHERE report_id=?
               AND EXISTS (
                 SELECT 1 FROM reports
                 WHERE id=? AND status='draft'
               )`,
          )
          .bind(reportId, reportId),
        ...tasks.map((task) =>
          database
            .prepare(
              `INSERT INTO tasks
                 (report_id,user_id,client_id,task_type,content_type,action,
                  quantity,is_new_content,status,description,occurred_on)
               SELECT ?,?,?,?,?,?,?,?,?,?,?
               WHERE EXISTS (
                 SELECT 1 FROM reports WHERE id=? AND status='draft'
               )`,
            )
            .bind(
              reportId,
              user.id,
              task.clientId,
              task.actionType,
              task.contentType,
              task.action,
              task.quantity,
              task.isNewContent == null ? null : task.isNewContent ? 1 : 0,
              task.status,
              task.notes,
              reportDate,
              reportId,
            ),
        ),
      ];
      await database.batch(statements);
      return Response.json({ ok: true, status: "draft", reportId: String(reportId) });
    }

    await validateConsumption(tasks, database, {
      id: user.id,
      displayName: user.displayName,
    });
    const submittedAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      database
        .prepare("INSERT INTO report_commits (report_id) VALUES (?)")
        .bind(reportId),
      database
        .prepare("DELETE FROM tasks WHERE report_id=?")
        .bind(reportId),
      database
        .prepare(
          `UPDATE reports
           SET status='submitted',summary=?,submitted_at=?,updated_at=CURRENT_TIMESTAMP
           WHERE id=? AND status='draft'`,
        )
        .bind(summary, submittedAt, reportId),
    ];
    const sessionAlertIds = new Set<number>();

    for (const task of tasks) {
      appendCommittedTaskStatements(statements, database, task, {
        reportId,
        userId: user.id,
        reportDate,
        isCorrection: false,
        sessionAlertIds,
      });
    }

    try {
      await database.batch(statements);
    } catch (batchError) {
      const message = String(batchError);
      if (message.includes("report_commits") || message.includes("UNIQUE")) {
        throw new AuthError(
          409,
          "REPORT_ALREADY_SUBMITTED",
          "Today’s report was already submitted. No duplicate changes were made.",
        );
      }
      if (
        message.includes("inventory_balances_nonnegative") ||
        message.includes("CHECK constraint")
      ) {
        throw new AuthError(
          409,
          "CONTENT_UNAVAILABLE",
          "The selected content is no longer available. Inventory was not changed.",
        );
      }
      throw batchError;
    }

    await sendSessionAlerts(sessionAlertIds);

    return Response.json({
      ok: true,
      status: "submitted",
      reportId: String(reportId),
      submittedAt,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

function appendCommittedTaskStatements(
  statements: D1PreparedStatement[],
  database: D1Database,
  task: NormalizedTask,
  context: {
    reportId: number;
    userId: number;
    reportDate: string;
    isCorrection: boolean;
    sessionAlertIds: Set<number>;
  },
) {
  statements.push(
    database
      .prepare(
        `INSERT INTO tasks
           (report_id,user_id,client_id,task_type,content_type,action,
            quantity,is_new_content,status,description,occurred_on,is_correction)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        context.reportId,
        context.userId,
        task.clientId,
        task.actionType,
        task.contentType,
        task.action,
        task.quantity,
        task.isNewContent == null ? null : task.isNewContent ? 1 : 0,
        task.status,
        task.notes,
        context.reportDate,
        context.isCorrection ? 1 : 0,
      ),
  );

  if (task.inventoryDelta !== 0 && task.contentType && task.clientId) {
    statements.push(
      database
        .prepare(
          `UPDATE inventory_balances
           SET quantity=quantity+?,updated_at=CURRENT_TIMESTAMP
           WHERE client_id=? AND content_type=?`,
        )
        .bind(task.inventoryDelta, task.clientId, task.contentType),
      database
        .prepare(
          `INSERT INTO inventory_events
             (client_id,content_type,delta,event_type,actor_user_id,note,occurred_on)
           VALUES (?,?,?,?,?,?,?)`,
        )
        .bind(
          task.clientId,
          task.contentType,
          task.inventoryDelta,
          task.actionType,
          context.userId,
          task.notes,
          context.reportDate,
        ),
      database
        .prepare("UPDATE clients SET updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(task.clientId),
    );
  }

  if (
    task.actionType === "session_scheduled" &&
    task.sessionAt &&
    task.clientId
  ) {
    statements.push(
      database
        .prepare(
          `INSERT INTO sessions
             (client_id,created_by_user_id,scheduled_for,status,notes)
           VALUES (?,?,?,'scheduled',?)`,
        )
        .bind(task.clientId, context.userId, task.sessionAt, task.notes),
    );
  }

  if (
    ["session_completed", "session_cancelled", "session_missed"].includes(
      task.actionType,
    ) &&
    task.sessionId &&
    task.clientId
  ) {
    const sessionStatus = task.actionType.replace("session_", "");
    statements.push(
      database
        .prepare(
          `UPDATE sessions
           SET status=?,
               reels_shot=CASE WHEN ?='completed' THEN ? ELSE reels_shot END,
               updated_at=CURRENT_TIMESTAMP
           WHERE id=? AND client_id=? AND status='scheduled'
             AND NOT EXISTS (
               SELECT 1 FROM session_deletions d
               WHERE d.session_id=sessions.id
             )`,
        )
        .bind(
          sessionStatus,
          sessionStatus,
          task.reelsShot,
          task.sessionId,
          task.clientId,
        ),
    );
    if (sessionStatus === "completed" && task.shotReelDelta > 0) {
      const eventType = `session_shot_reels:${task.sessionId}:initial`;
      const sessionEventPattern = `session_shot_reels:${task.sessionId}:*`;
      statements.push(
        database
          .prepare(
            `UPDATE inventory_balances
             SET quantity=quantity+?,updated_at=CURRENT_TIMESTAMP
             WHERE client_id=? AND content_type='shot_reel'
               AND EXISTS (
                 SELECT 1 FROM sessions s
                 WHERE s.id=? AND s.client_id=? AND s.status='completed'
                   AND s.reels_shot=?
               )
               AND NOT EXISTS (
                 SELECT 1 FROM inventory_events e
                 WHERE e.event_type GLOB ?
               )`,
          )
          .bind(
            task.shotReelDelta,
            task.clientId,
            task.sessionId,
            task.clientId,
            task.reelsShot,
            sessionEventPattern,
          ),
        database
          .prepare(
            `INSERT OR IGNORE INTO inventory_events
               (client_id,content_type,delta,event_type,actor_user_id,note,occurred_on)
             SELECT ?, 'shot_reel', ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM sessions s
               WHERE s.id=? AND s.client_id=? AND s.status='completed'
                 AND s.reels_shot=?
             )
               AND NOT EXISTS (
                 SELECT 1 FROM inventory_events e
                 WHERE e.event_type GLOB ?
               )`,
          )
          .bind(
            task.clientId,
            task.shotReelDelta,
            eventType,
            context.userId,
            task.notes,
            context.reportDate,
            task.sessionId,
            task.clientId,
            task.reelsShot,
            sessionEventPattern,
          ),
        database
          .prepare("UPDATE clients SET updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(task.clientId),
      );
    }
    if (sessionStatus === "cancelled" || sessionStatus === "missed") {
      context.sessionAlertIds.add(task.sessionId);
    }
  } else if (task.shotReelDelta !== 0 && task.clientId) {
    statements.push(
      database
        .prepare(
          `UPDATE inventory_balances
           SET quantity=quantity+?,updated_at=CURRENT_TIMESTAMP
           WHERE client_id=? AND content_type='shot_reel'`,
        )
        .bind(task.shotReelDelta, task.clientId),
      database
        .prepare(
          `INSERT INTO inventory_events
             (client_id,content_type,delta,event_type,actor_user_id,note,occurred_on)
           VALUES (?,'shot_reel',?,'shot_reel_edited',?,?,?)`,
        )
        .bind(
          task.clientId,
          task.shotReelDelta,
          context.userId,
          task.notes,
          context.reportDate,
        ),
      database
        .prepare("UPDATE clients SET updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(task.clientId),
    );
  }
}

async function sendSessionAlerts(sessionAlertIds: Set<number>) {
  for (const sessionId of sessionAlertIds) {
    try {
      await notifySessionStatus(sessionId);
    } catch (notificationError) {
      // The committed report must remain successful. The once-per-minute
      // scheduler will retry any session whose alert marker is still empty.
      console.error(
        `Could not send the alert for session ${sessionId}; the scheduler will retry.`,
        notificationError,
      );
    }
  }
}

function reportWindowMessage(
  reason:
    | "before_work_start"
    | "after_deadline"
    | "day_off"
    | "no_working_days"
    | null,
  nextOpenAt: string | null,
) {
  const nextOpen = nextOpenAt
    ? ` It opens again ${new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Damascus",
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(nextOpenAt))}.`
    : "";
  if (reason === "before_work_start") {
    return `Daily reporting has not opened yet.${nextOpen}`;
  }
  if (reason === "after_deadline") {
    return `Today’s report deadline has passed.${nextOpen}`;
  }
  if (reason === "day_off") {
    return `Daily reporting is closed on your day off.${nextOpen}`;
  }
  return "No working days are currently assigned to your profile.";
}

async function normalizeTasks(
  rawTasks: RawTask[],
  role: "editor" | "designer" | "account_manager" | "content_creator" | "content_manager",
  clients: Map<number, ClientRow>,
  database: D1Database,
): Promise<NormalizedTask[]> {
  const allowed: Record<string, string[]> = {
    editor: ["reel_new", "reel_reedit", "other"],
    designer: ["post_new", "story_new", "post_revision", "other"],
    content_creator: ["meeting", "draft_created", "session_attended"],
    content_manager: ["publish_reel", "publish_post", "publish_story"],
    account_manager: [
      "publish_reel",
      "publish_post",
      "publish_story",
      "draft_created",
      "meeting",
      "session_scheduled",
      "session_completed",
      "session_cancelled",
      "session_missed",
      "competitor_analysis",
      "agency_report",
      "agency_observation",
      "other",
    ],
  };
  const normalized: NormalizedTask[] = [];
  for (const raw of rawTasks) {
    const actionType = String(raw.actionType ?? "");
    if (!allowed[role].includes(actionType)) {
      throw new AuthError(
        403,
        "ACTION_NOT_ALLOWED",
        "That task type is not available for your role.",
      );
    }
    const isAgencyAction =
      role === "account_manager" && AGENCY_ACTIONS.has(actionType);
    const isOtherClient = raw.clientId === OTHER_CLIENT_ID;
    if (isOtherClient && actionType !== "other") {
      throw new AuthError(
        400,
        "OTHER_REQUIRES_OTHER_TASK",
        "Use the Other task action for non-client work. Content and sessions need a real client.",
      );
    }
    const rawClientId =
      raw.clientId === "" || raw.clientId == null || isOtherClient
        ? null
        : Number(raw.clientId);
    const client = rawClientId == null ? undefined : clients.get(rawClientId);
    if (!isAgencyAction && !isOtherClient && !client) {
      throw new AuthError(400, "INVALID_CLIENT", "Choose a valid active client.");
    }
    const clientId = isAgencyAction || isOtherClient ? null : client!.id;
    let quantity = Number(raw.quantity ?? 1);
    let reelsShot: number | null = null;
    if (actionType === "session_completed") {
      reelsShot = Number(raw.reelsShot);
      if (
        !Number.isSafeInteger(reelsShot) ||
        reelsShot < 0 ||
        reelsShot > 500
      ) {
        throw new AuthError(
          400,
          "INVALID_REELS_SHOT",
          "Enter how many reels were shot in the completed session (0–500).",
        );
      }
      quantity = reelsShot;
    } else if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 50
    ) {
      throw new AuthError(
        400,
        "INVALID_QUANTITY",
        "Quantity must be between 1 and 50.",
      );
    }
    const notes = String(raw.notes ?? "").trim();
    if (notes.length > 1_000) {
      throw new AuthError(
        400,
        "INVALID_DESCRIPTION",
        "The optional task details must be 1,000 characters or fewer.",
      );
    }
    if (isOtherClient && !notes) {
      throw new AuthError(
        400,
        "OTHER_DETAILS_REQUIRED",
        "Describe the non-client work before saving the report.",
      );
    }
    const status = raw.status === "in_progress" ? "in_progress" : "completed";
    let contentType: NormalizedTask["contentType"] = null;
    let action: string | null = null;
    let isNewContent: boolean | null = null;
    let inventoryDelta = 0;
    let shotReelDelta = 0;
    let sessionAt: string | null = null;
    let sessionId: number | null = null;

    if (actionType === "reel_new") {
      contentType = "reel";
      action = "produced";
      isNewContent = true;
      inventoryDelta = status === "completed" ? quantity : 0;
      shotReelDelta = status === "completed" ? -quantity : 0;
    } else if (actionType === "reel_reedit") {
      contentType = "reel";
      action = "re_edit";
      isNewContent = false;
    } else if (actionType === "post_new" || actionType === "story_new") {
      contentType = actionType === "story_new" ? "story" : "post";
      action = "produced";
      isNewContent = true;
      inventoryDelta = status === "completed" ? quantity : 0;
    } else if (actionType === "post_revision") {
      contentType = "post";
      action = "revision";
      isNewContent = false;
    } else if (actionType === "publish_reel") {
      contentType = "reel";
      action = "published";
      inventoryDelta = -quantity;
    } else if (actionType === "publish_post" || actionType === "publish_story") {
      contentType = actionType === "publish_story" ? "story" : "post";
      action = "published";
      inventoryDelta = -quantity;
    } else if (actionType === "draft_created") {
      contentType = "draft";
      action = "created";
      inventoryDelta = quantity;
      isNewContent = true;
    } else if (actionType === "session_scheduled") {
      try {
        sessionAt = localDamascusDateTimeToIso(String(raw.sessionAt ?? ""));
      } catch (error) {
        throw new AuthError(400, "INVALID_SESSION_TIME", (error as Error).message);
      }
      if (new Date(sessionAt).getTime() <= Date.now()) {
        throw new AuthError(
          400,
          "SESSION_IN_PAST",
          "A newly scheduled session must be in the future.",
        );
      }
      action = sessionAt;
    } else if (
      ["session_completed", "session_cancelled", "session_missed", "session_attended"].includes(actionType)
    ) {
      sessionId = Number(raw.sessionId);
      if (!Number.isSafeInteger(sessionId) || sessionId < 1) {
        throw new AuthError(
          400,
          "INVALID_SESSION",
          "Choose the scheduled session you are updating.",
        );
      }
      const session = await database
        .prepare(
          `SELECT id FROM sessions
           WHERE id=? AND client_id=? AND status='scheduled'
             AND NOT EXISTS (
               SELECT 1 FROM session_deletions d
               WHERE d.session_id=sessions.id
             )
           LIMIT 1`,
        )
        .bind(sessionId, clientId)
        .first<{ id: number }>();
      if (!session) {
        throw new AuthError(
          409,
          "SESSION_NOT_AVAILABLE",
          "That session is no longer scheduled or belongs to another client.",
        );
      }
      action = String(sessionId);
      if (actionType === "session_completed") {
        shotReelDelta = reelsShot ?? 0;
      }
    }

    normalized.push({
      clientId,
      clientName: isOtherClient ? "Other" : client?.name ?? null,
      actionType,
      status,
      quantity,
      notes,
      contentType,
      action,
      isNewContent,
      inventoryDelta,
      shotReelDelta,
      sessionAt,
      sessionId,
      reelsShot,
    });
  }
  return normalized;
}

function isoToDamascusLocal(value: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Damascus",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

async function validateConsumption(
  tasks: NormalizedTask[],
  database: D1Database,
  actor: { id: number; displayName: string },
) {
  const required = new Map<string, { clientId: number; type: string; quantity: number; clientName: string }>();
  for (const task of tasks) {
    const movements: Array<{ type: string; delta: number }> = [];
    if (task.contentType && task.inventoryDelta < 0) {
      movements.push({ type: task.contentType, delta: task.inventoryDelta });
    }
    if (task.shotReelDelta < 0) {
      movements.push({ type: "shot_reel", delta: task.shotReelDelta });
    }
    if (!task.clientId || !task.clientName) continue;
    for (const movement of movements) {
      const key = `${task.clientId}:${movement.type}`;
      const current = required.get(key);
      required.set(key, {
        clientId: task.clientId,
        type: movement.type,
        quantity: (current?.quantity ?? 0) + Math.abs(movement.delta),
        clientName: task.clientName,
      });
    }
  }
  for (const item of required.values()) {
    const balance = await database
      .prepare(
        `SELECT quantity FROM inventory_balances
         WHERE client_id=? AND content_type=?`,
      )
      .bind(item.clientId, item.type)
      .first<{ quantity: number }>();
    if (!balance || balance.quantity < item.quantity) {
      await notifyUnavailableContent(database, {
        actor,
        clientId: item.clientId,
        clientName: item.clientName,
        contentType: item.type,
        available: balance?.quantity ?? 0,
        requested: item.quantity,
      });
      throw new AuthError(
        409,
        "CONTENT_UNAVAILABLE",
        item.type === "shot_reel"
          ? `${item.clientName} has only ${balance?.quantity ?? 0} shot reel${balance?.quantity === 1 ? "" : "s"} waiting for editing. Add the session footage before completing more new reels.`
          : `${item.clientName} has only ${balance?.quantity ?? 0} ${item.type}${balance?.quantity === 1 ? "" : "s"} available. Posting was blocked.`,
      );
    }
  }
}

async function notifyUnavailableContent(
  database: D1Database,
  input: {
    actor: { id: number; displayName: string };
    clientId: number;
    clientName: string;
    contentType: string;
    available: number;
    requested: number;
  },
) {
  const date = damascusDate();
  const dedupeKey = `unavailable:${date}:${input.actor.id}:${input.clientId}:${input.contentType}`;
  const arabicType =
    input.contentType === "reel"
      ? "ريل"
      : input.contentType === "post"
        ? "بوست"
        : input.contentType === "shot_reel"
          ? "ريل مصوّر بانتظار المونتاج"
          : "مسودة";
  await database
    .prepare(
      `INSERT INTO notifications
         (recipient_user_id,kind,channel,title_en,title_ar,message_en,message_ar,
          related_client_id,dedupe_key,due_at,sent_at,status)
       SELECT
         id,'content_unavailable','browser',
         'Unavailable content action blocked',
         'تم منع إجراء على محتوى غير متوفر',
         ?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'ready'
       FROM users
       WHERE is_active=1 AND (role='admin' OR id=?)
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.recipient_user_id=users.id AND n.dedupe_key=?
         )`,
    )
    .bind(
      `${input.actor.displayName} tried to use ${input.requested} ${input.contentType}(s) for ${input.clientName}, but only ${input.available} were available. Nothing was changed.`,
      `حاول ${input.actor.displayName} استخدام ${input.requested} ${arabicType} للعميل ${input.clientName}، لكن المتوفر هو ${input.available} فقط. لم يتم تغيير أي شيء.`,
      input.clientId,
      dedupeKey,
      input.actor.id,
      dedupeKey,
    )
    .run();
}

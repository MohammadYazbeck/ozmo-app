import { AuthError, authErrorResponse, requireAdmin } from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import { damascusDate, localDamascusDateTimeToIso } from "@/lib/time";

const OTHER_CLIENT_ID = "__other__";
const AGENCY_ACTIONS = new Set([
  "competitor_analysis",
  "agency_report",
  "agency_observation",
]);

type RawTask = {
  clientId?: unknown;
  actionType?: unknown;
  status?: unknown;
  quantity?: unknown;
  notes?: unknown;
  reelsShot?: unknown;
  sessionAt?: unknown;
  sessionId?: unknown;
};

type ReportRow = {
  id: number;
  user_id: number;
  report_date: string;
  status: "draft" | "submitted";
  summary: string;
  submitted_at: string | null;
  display_name: string;
  role: "editor" | "designer" | "account_manager";
};

type TaskRow = {
  id: number;
  client_id: number | null;
  client_name: string | null;
  task_type: string;
  action: string | null;
  content_type: "reel" | "post" | "draft" | null;
  quantity: number;
  status: "completed" | "in_progress";
  description: string;
  occurred_on: string;
  reels_shot: number | null;
};

type ClientRow = { id: number; name: string };

type NormalizedTask = {
  clientId: number | null;
  clientName: string | null;
  actionType: string;
  status: "completed" | "in_progress";
  quantity: number;
  notes: string;
  contentType: "reel" | "post" | "draft" | null;
  action: string | null;
  isNewContent: boolean | null;
  inventoryDelta: number;
  shotReelDelta: number;
  sessionAt: string | null;
  sessionId: number | null;
  reelsShot: number | null;
};

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const date = new URL(request.url).searchParams.get("date") ?? damascusDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new AuthError(400, "INVALID_REPORT_DATE", "Choose a valid report date.");
    }
    const database = getD1();
    const reports = await database
      .prepare(
        `SELECT r.id,r.user_id,r.report_date,r.status,r.summary,r.submitted_at,
                u.display_name,u.role
         FROM reports r
         JOIN users u ON u.id=r.user_id
         WHERE r.report_date=? AND u.role<>'admin'
         ORDER BY u.display_name`,
      )
      .bind(date)
      .all<ReportRow>();
    const taskRows = reports.results.length
      ? await database
          .prepare(
            `SELECT t.id,t.report_id,t.client_id,c.name AS client_name,
                    t.task_type,t.action,t.content_type,t.quantity,t.status,
                    t.description,t.occurred_on,t.reels_shot
             FROM tasks t
             LEFT JOIN clients c ON c.id=t.client_id
             WHERE t.report_id IN (${reports.results.map(() => "?").join(",")})
             ORDER BY t.report_id,t.id`,
          )
          .bind(...reports.results.map((report) => report.id))
          .all<TaskRow & { report_id: number }>()
      : { results: [] as Array<TaskRow & { report_id: number }> };
    const tasksByReport = new Map<number, Array<TaskRow & { report_id: number }>>();
    for (const task of taskRows.results) {
      const rows = tasksByReport.get(task.report_id) ?? [];
      rows.push(task);
      tasksByReport.set(task.report_id, rows);
    }
    return Response.json({
      date,
      reports: reports.results.map((report) => ({
        id: String(report.id),
        userId: String(report.user_id),
        reportDate: report.report_date,
        status: report.status,
        summary: report.summary,
        submittedAt: report.submitted_at,
        displayName: report.display_name,
        role: report.role,
        tasks: (tasksByReport.get(report.id) ?? []).map(taskToClientTask),
      })),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin(request);
    await ensureDatabase();
    const body = (await request.json().catch(() => null)) as {
      reportId?: unknown;
      tasks?: unknown;
    } | null;
    const reportId = Number(body?.reportId);
    if (!Number.isSafeInteger(reportId) || reportId < 1 || !Array.isArray(body?.tasks)) {
      throw new AuthError(400, "INVALID_REPORT", "Choose a report and enter its tasks.");
    }
    if (body.tasks.length < 1 || body.tasks.length > 50) {
      throw new AuthError(400, "INVALID_TASKS", "A report needs between 1 and 50 tasks.");
    }
    const database = getD1();
    const report = await database
      .prepare(
        `SELECT r.id,r.user_id,r.report_date,r.status,r.summary,r.submitted_at,
                u.display_name,u.role
         FROM reports r JOIN users u ON u.id=r.user_id
         WHERE r.id=? AND u.role<>'admin' LIMIT 1`,
      )
      .bind(reportId)
      .first<ReportRow>();
    if (!report) throw new AuthError(404, "REPORT_NOT_FOUND", "That report was not found.");

    const clients = await database
      .prepare("SELECT id,name FROM clients WHERE is_active=1")
      .all<ClientRow>();
    const clientMap = new Map(clients.results.map((client) => [client.id, client]));
    const normalized = await normalizeTasks(
      body.tasks as RawTask[],
      report.role,
      clientMap,
    );
    const oldTasks = await database
      .prepare(
        `SELECT t.id,t.client_id,c.name AS client_name,t.task_type,t.action,
                t.content_type,t.quantity,t.status,t.description,t.occurred_on,
                t.reels_shot
         FROM tasks t LEFT JOIN clients c ON c.id=t.client_id
         WHERE t.report_id=? ORDER BY t.id`,
      )
      .bind(report.id)
      .all<TaskRow>();

    const net = new Map<string, { clientId: number; contentType: string; delta: number; clientName: string }>();
    const addEffect = (task: { clientId: number | null; clientName: string | null; inventoryDelta: number; inventoryContentType?: string | null; shotReelDelta: number }) => {
      if (!task.clientId || !task.clientName) return;
      if (task.inventoryDelta !== 0 && task.inventoryContentType) addNet(task.clientId, task.clientName, task.inventoryDelta, task.inventoryContentType);
      if (task.shotReelDelta !== 0) addNet(task.clientId, task.clientName, task.shotReelDelta, "shot_reel");
    };
    for (const oldTask of oldTasks.results) addEffect({ ...oldTaskEffects(oldTask), clientName: oldTask.client_name });
    for (const task of normalized) addEffect({ ...task, inventoryContentType: task.contentType });
    function addNet(clientId: number, clientName: string, delta: number, contentType: string) {
      const key = `${clientId}:${contentType}`;
      const existing = net.get(key);
      net.set(key, {
        clientId,
        clientName,
        contentType,
        delta: (existing?.delta ?? 0) + delta,
      });
    }
    // Old report effects are removed first; new effects are then applied.
    for (const oldTask of oldTasks.results) {
      const effect = oldTaskEffects(oldTask);
      addEffect({ clientId: effect.clientId, clientName: oldTask.client_name, inventoryDelta: -effect.inventoryDelta, inventoryContentType: effect.inventoryContentType, shotReelDelta: -effect.shotReelDelta });
    }

    for (const item of net.values()) {
      const balance = await database
        .prepare("SELECT quantity FROM inventory_balances WHERE client_id=? AND content_type=?")
        .bind(item.clientId, item.contentType)
        .first<{ quantity: number }>();
      if (!balance || Number(balance.quantity) + item.delta < 0) {
        throw new AuthError(409, "CONTENT_UNAVAILABLE", `${item.clientName} does not have enough ${item.contentType} inventory for this edited report.`);
      }
    }

    const summary = normalized.map((task) => task.notes).join("\n").slice(0, 4_000);
    const statements: D1PreparedStatement[] = [
      database.prepare("DELETE FROM tasks WHERE report_id=?").bind(report.id),
      database.prepare("UPDATE reports SET summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(summary, report.id),
    ];
    for (const item of net.values()) {
      if (item.delta === 0) continue;
      statements.push(
        database.prepare("UPDATE inventory_balances SET quantity=quantity+?,updated_at=CURRENT_TIMESTAMP WHERE client_id=? AND content_type=?").bind(item.delta, item.clientId, item.contentType),
        database.prepare("INSERT INTO inventory_events (client_id,content_type,delta,event_type,actor_user_id,note,occurred_on) VALUES (?,?,?,?,?,?,?)").bind(item.clientId, item.contentType, item.delta, "admin_report_edit", report.user_id, `Admin report edit by ${admin.displayName}`, report.report_date),
        database.prepare("UPDATE clients SET updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(item.clientId),
      );
    }
    for (const task of normalized) {
      statements.push(
        database.prepare(
          `INSERT INTO tasks
             (report_id,user_id,client_id,task_type,content_type,action,quantity,
              is_new_content,status,description,occurred_on,is_correction)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
        ).bind(
          report.id,
          report.user_id,
          task.clientId,
          task.actionType,
          task.contentType,
          task.action,
          task.quantity,
          task.isNewContent == null ? null : task.isNewContent ? 1 : 0,
          task.status,
          task.notes,
          report.report_date,
        ),
      );
      if (task.actionType === "session_scheduled" && task.clientId && task.sessionAt) {
        statements.push(
          database.prepare(
            `INSERT INTO sessions
               (client_id,created_by_user_id,scheduled_for,status,notes)
             VALUES (?,?,?,'scheduled',?)`,
          ).bind(task.clientId, report.user_id, task.sessionAt, task.notes),
        );
      }
      if (
        ["session_completed", "session_cancelled", "session_missed"].includes(task.actionType) &&
        task.clientId && task.sessionId
      ) {
        const sessionStatus = task.actionType.replace("session_", "");
        statements.push(
          database.prepare(
            `UPDATE sessions
             SET status=?,reels_shot=CASE WHEN ?='completed' THEN ? ELSE reels_shot END,
                 updated_at=CURRENT_TIMESTAMP
             WHERE id=? AND client_id=? AND status='scheduled'`,
          ).bind(sessionStatus, sessionStatus, task.reelsShot, task.sessionId, task.clientId),
        );
      }
    }
    await database.batch(statements);
    return Response.json({ ok: true, reportId: String(report.id), status: report.status });
  } catch (error) {
    return authErrorResponse(error);
  }
}

function taskToClientTask(task: TaskRow) {
  return {
    id: String(task.id),
    clientId: task.client_id == null && task.task_type === "other" ? OTHER_CLIENT_ID : task.client_id == null ? "" : String(task.client_id),
    clientName: task.client_name,
    actionType: task.task_type,
    status: task.status,
    quantity: task.quantity,
    notes: task.description,
    sessionAt: task.task_type === "session_scheduled" ? task.action ?? undefined : undefined,
    sessionId: task.task_type.startsWith("session_") && task.task_type !== "session_scheduled" ? task.action ?? undefined : undefined,
    reelsShot: task.reels_shot,
  };
}

function oldTaskEffects(task: TaskRow) {
  let inventoryDelta = 0;
  let shotReelDelta = 0;
  if (task.status === "completed") {
    if (task.task_type === "reel_new") {
      inventoryDelta = task.quantity;
      shotReelDelta = -task.quantity;
    } else if (task.task_type === "post_new") inventoryDelta = task.quantity;
    else if (task.task_type === "draft_created") inventoryDelta = task.quantity;
    else if (task.task_type === "publish_reel" || task.task_type === "publish_post") inventoryDelta = -task.quantity;
    else if (task.task_type === "session_completed") shotReelDelta = task.quantity;
  }
  return { clientId: task.client_id, inventoryDelta, inventoryContentType: task.content_type, shotReelDelta };
}

async function normalizeTasks(rawTasks: RawTask[], role: ReportRow["role"], clients: Map<number, ClientRow>) {
  const allowed: Record<ReportRow["role"], string[]> = {
    editor: ["reel_new", "reel_reedit", "other"],
    designer: ["post_new", "post_revision", "other"],
    account_manager: ["publish_reel", "publish_post", "draft_created", "meeting", "session_scheduled", "session_completed", "session_cancelled", "session_missed", "competitor_analysis", "agency_report", "agency_observation", "other"],
  };
  const output: NormalizedTask[] = [];
  for (const raw of rawTasks) {
    const actionType = String(raw.actionType ?? "");
    if (!allowed[role].includes(actionType)) throw new AuthError(403, "ACTION_NOT_ALLOWED", "That task type is not available for this staff member.");
    const isAgency = role === "account_manager" && AGENCY_ACTIONS.has(actionType);
    const isOther = raw.clientId === OTHER_CLIENT_ID;
    const rawClientId = raw.clientId === "" || raw.clientId == null || isOther ? null : Number(raw.clientId);
    const client = rawClientId == null ? undefined : clients.get(rawClientId);
    if (!isAgency && !isOther && !client) throw new AuthError(400, "INVALID_CLIENT", "Choose a valid active client.");
    if (isOther && actionType !== "other") throw new AuthError(400, "OTHER_REQUIRES_OTHER_TASK", "Use Other for non-client work.");
    let quantity = Number(raw.quantity ?? 1);
    let reelsShot: number | null = null;
    if (actionType === "session_completed") {
      reelsShot = Number(raw.reelsShot);
      if (!Number.isSafeInteger(reelsShot) || reelsShot < 0 || reelsShot > 500) throw new AuthError(400, "INVALID_REELS_SHOT", "Enter a valid shot reel count.");
      quantity = reelsShot;
    } else if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50) {
      throw new AuthError(400, "INVALID_QUANTITY", "Quantity must be between 1 and 50.");
    }
    const notes = String(raw.notes ?? "").trim();
    if (notes.length > 1_000 || (isOther && !notes)) throw new AuthError(400, "INVALID_DESCRIPTION", "Enter valid task details.");
    const status = raw.status === "in_progress" ? "in_progress" : "completed";
    const clientId = isAgency || isOther ? null : client!.id;
    let contentType: NormalizedTask["contentType"] = null;
    let action: string | null = null;
    let isNewContent: boolean | null = null;
    let inventoryDelta = 0;
    let shotReelDelta = 0;
    let sessionAt: string | null = null;
    let sessionId: number | null = null;
    if (actionType === "reel_new") { contentType = "reel"; action = "produced"; isNewContent = true; inventoryDelta = status === "completed" ? quantity : 0; shotReelDelta = status === "completed" ? -quantity : 0; }
    else if (actionType === "reel_reedit") { contentType = "reel"; action = "re_edit"; isNewContent = false; }
    else if (actionType === "post_new") { contentType = "post"; action = "produced"; isNewContent = true; inventoryDelta = status === "completed" ? quantity : 0; }
    else if (actionType === "post_revision") { contentType = "post"; action = "revision"; isNewContent = false; }
    else if (actionType === "publish_reel") { contentType = "reel"; action = "published"; inventoryDelta = -quantity; }
    else if (actionType === "publish_post") { contentType = "post"; action = "published"; inventoryDelta = -quantity; }
    else if (actionType === "draft_created") { contentType = "draft"; action = "created"; inventoryDelta = quantity; isNewContent = true; }
    else if (["session_completed", "session_cancelled", "session_missed"].includes(actionType)) {
      sessionId = Number(raw.sessionId);
      if (!Number.isSafeInteger(sessionId) || sessionId < 1) throw new AuthError(400, "INVALID_SESSION", "Choose the session being updated.");
      action = String(sessionId);
      if (actionType === "session_completed") shotReelDelta = reelsShot ?? 0;
    }
    else if (actionType === "session_scheduled") { sessionAt = localDamascusDateTimeToIso(String(raw.sessionAt ?? "")); action = sessionAt; }
    output.push({ clientId, clientName: isOther ? "Other" : client?.name ?? null, actionType, status, quantity, notes, contentType, action, isNewContent, inventoryDelta, shotReelDelta, sessionAt, sessionId, reelsShot });
  }
  return output;
}

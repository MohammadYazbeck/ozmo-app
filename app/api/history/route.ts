import {
  AuthError,
  authErrorResponse,
  requireAdmin,
  requireUser,
} from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";

type TaskHistoryRow = {
  id: number;
  date: string;
  actor_name: string;
  actor_role: "admin" | "editor" | "designer" | "account_manager" | "content_creator" | "content_manager";
  client_name: string | null;
  task_type: string;
  description: string;
  content_type: "reel" | "post" | "story" | "draft" | null;
  quantity: number;
  status: string;
};

type InventoryHistoryRow = {
  id: number;
  date: string;
  actor_name: string;
  actor_role: "admin";
  client_name: string;
  content_type: "reel" | "shot_reel" | "post" | "story" | "draft";
  delta: number;
  note: string;
};

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureDatabase();
    const database = getD1();
    const taskQuery =
      user.role === "admin"
        ? database.prepare(
            `SELECT
               t.id,t.created_at AS date,u.display_name AS actor_name,
               u.role AS actor_role,c.name AS client_name,t.task_type,
               t.description,t.content_type,t.quantity,t.status
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
             LIMIT 500`,
          )
        : database
            .prepare(
              `SELECT
                 t.id,t.created_at AS date,u.display_name AS actor_name,
                 u.role AS actor_role,c.name AS client_name,t.task_type,
                 t.description,t.content_type,t.quantity,t.status
               FROM tasks t
               JOIN users u ON u.id=t.user_id
               LEFT JOIN clients c ON c.id=t.client_id
               LEFT JOIN reports r ON r.id=t.report_id
               WHERE t.user_id=?
                 AND (t.report_id IS NULL OR r.status='submitted')
                 AND NOT EXISTS (
                   SELECT 1 FROM activity_log_hides h
                   WHERE h.source_type='task' AND h.source_id=t.id
                 )
               ORDER BY t.created_at DESC,t.id DESC
               LIMIT 500`,
            )
            .bind(user.id);

    const tasks = await taskQuery.all<TaskHistoryRow>();
    const history = tasks.results.map(taskToHistory);

    if (user.role === "admin") {
      const adjustments = await database
        .prepare(
          `SELECT
             e.id,e.created_at AS date,u.display_name AS actor_name,
             u.role AS actor_role,c.name AS client_name,e.content_type,
             e.delta,e.note
           FROM inventory_events e
           JOIN users u ON u.id=e.actor_user_id
           JOIN clients c ON c.id=e.client_id
           WHERE e.event_type='manual_adjustment'
             AND NOT EXISTS (
               SELECT 1 FROM activity_log_hides h
               WHERE h.source_type='inventory' AND h.source_id=e.id
             )
           ORDER BY e.created_at DESC,e.id DESC
           LIMIT 250`,
        )
        .all<InventoryHistoryRow>();
      history.push(
        ...adjustments.results.map((item) => ({
          id: `inventory-${item.id}`,
          date: item.date,
          actorName: item.actor_name,
          actorRole: item.actor_role,
          clientName: item.client_name,
          actionType: "inventory_adjustment",
          notes: item.note,
          reelDelta: item.content_type === "reel" ? item.delta : 0,
          shotReelDelta:
            item.content_type === "shot_reel" ? item.delta : 0,
          postDelta: item.content_type === "post" ? item.delta : 0,
          draftDelta: item.content_type === "draft" ? item.delta : 0,
          source: "inventory",
        })),
      );
      history.sort(
        (left, right) =>
          new Date(right.date).getTime() - new Date(left.date).getTime(),
      );
    }

    return Response.json({ history: history.slice(0, 500) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin(request);
    await ensureDatabase();
    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
      reason?: unknown;
    } | null;
    const match =
      typeof body?.id === "string"
        ? /^(task|inventory)-(\d+)$/.exec(body.id)
        : null;
    if (!match) {
      throw new AuthError(
        400,
        "INVALID_HISTORY_ITEM",
        "Choose a valid activity-log entry.",
      );
    }
    const sourceType = match[1] as "task" | "inventory";
    const sourceId = Number(match[2]);
    const reason =
      typeof body?.reason === "string" ? body.reason.trim() : "";
    if (reason.length > 500) {
      throw new AuthError(
        400,
        "INVALID_REASON",
        "The optional reason must be 500 characters or fewer.",
      );
    }

    const database = getD1();
    const table = sourceType === "task" ? "tasks" : "inventory_events";
    const existing = await database
      .prepare(`SELECT id FROM ${table} WHERE id=? LIMIT 1`)
      .bind(sourceId)
      .first<{ id: number }>();
    if (!existing) {
      throw new AuthError(
        404,
        "HISTORY_ITEM_NOT_FOUND",
        "That activity-log entry was not found.",
      );
    }
    await database
      .prepare(
        `INSERT OR IGNORE INTO activity_log_hides
           (source_type,source_id,hidden_by_user_id,reason)
         VALUES (?,?,?,?)`,
      )
      .bind(sourceType, sourceId, admin.id, reason)
      .run();
    return Response.json({
      ok: true,
      hidden: true,
      id: `${sourceType}-${sourceId}`,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

function taskToHistory(task: TaskHistoryRow) {
  let delta = 0;
  if (
    (task.task_type === "reel_new" || task.task_type === "post_new") &&
    task.status === "completed"
  ) {
    delta = task.quantity;
  } else if (
    task.task_type === "publish_reel" ||
    task.task_type === "publish_post"
  ) {
    delta = -task.quantity;
  } else if (task.task_type === "draft_created") {
    delta = task.quantity;
  }
  return {
    id: `task-${task.id}`,
    date: task.date,
    actorName: task.actor_name,
    actorRole: task.actor_role,
    clientName:
      task.client_name ?? (task.task_type === "other" ? "Other" : null),
    actionType: task.task_type,
    notes: readableTaskNotes(
      task.task_type,
      task.description,
      task.quantity,
    ),
    reelDelta: task.content_type === "reel" ? delta : 0,
    shotReelDelta: taskShotReelDelta(task),
    postDelta: task.content_type === "post" ? delta : 0,
    draftDelta: task.content_type === "draft" ? delta : 0,
    source: "task",
  };
}

function taskShotReelDelta(task: TaskHistoryRow) {
  if (task.task_type === "session_completed") return task.quantity;
  if (task.task_type === "reel_new" && task.status === "completed") {
    return -task.quantity;
  }
  if (task.task_type !== "session" || !task.description.trim().startsWith("{")) {
    return 0;
  }
  try {
    const audit = JSON.parse(task.description) as {
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

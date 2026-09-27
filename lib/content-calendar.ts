import { getD1 } from "@/lib/db";

export type CalendarContentType = "reel" | "post";

function monthBounds(month: string) {
  const [year, rawMonth] = month.split("-").map(Number);
  if (!Number.isInteger(year) || rawMonth < 1 || rawMonth > 12) throw new Error("INVALID_MONTH");
  const start = new Date(Date.UTC(year, rawMonth - 1, 1));
  const end = new Date(Date.UTC(year, rawMonth, 1));
  return { start, end };
}

export function currentDamascusMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Damascus", year: "numeric", month: "2-digit" }).format(new Date());
}

export async function ensureCalendarItems(clientId: number, month: string) {
  const db = getD1();
  const client = await db.prepare("SELECT calendar_enabled FROM clients WHERE id=? AND is_active=1").bind(clientId).first<{ calendar_enabled: number }>();
  if (!client?.calendar_enabled) return;
  const rules = await db.prepare("SELECT weekday,content_type FROM client_calendar_rules WHERE client_id=?").bind(clientId).all<{ weekday: number; content_type: CalendarContentType }>();
  const { start, end } = monthBounds(month);
  const statements: D1PreparedStatement[] = [];
  for (let date = new Date(start); date < end; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = date.toISOString().slice(0, 10);
    for (const rule of rules.results.filter((item) => item.weekday === date.getUTCDay())) {
      statements.push(db.prepare(`INSERT OR IGNORE INTO client_calendar_items (client_id,scheduled_date,content_type) VALUES (?,?,?)`).bind(clientId, key, rule.content_type));
    }
  }
  if (statements.length) await db.batch(statements);
}

export async function syncCalendarFromReport(reportId: number) {
  const db = getD1();
  const tasks = await db.prepare(
    `SELECT id,client_id,task_type,quantity,occurred_on,status
     FROM tasks WHERE report_id=? AND status='completed' ORDER BY id`,
  ).bind(reportId).all<{ id: number; client_id: number | null; task_type: string; quantity: number; occurred_on: string; status: string }>();

  const months = [0, 1, 2].map((offset) => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Damascus", year: "numeric", month: "2-digit" }).formatToParts(now);
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });

  for (const task of tasks.results) {
    if (!task.client_id) continue;
    const type: CalendarContentType | null = task.task_type === "reel_new" || task.task_type === "publish_reel" ? "reel" : task.task_type === "post_new" || task.task_type === "publish_post" ? "post" : null;
    if (!type) continue;
    for (const month of months) await ensureCalendarItems(task.client_id, month);
    const production = task.task_type === "reel_new" || task.task_type === "post_new";
    const assigned = await db.prepare(`SELECT COUNT(*) AS count FROM client_calendar_items WHERE ${production ? "content_task_id" : "publish_task_id"}=?`).bind(task.id).first<{ count: number }>();
    const remaining = Math.max(0, Math.max(1, Number(task.quantity)) - Number(assigned?.count ?? 0));
    for (let count = 0; count < remaining; count += 1) {
      if (production) {
        await db.prepare(
          `UPDATE client_calendar_items SET status='ready',content_task_id=?,updated_at=CURRENT_TIMESTAMP
           WHERE id=(SELECT id FROM client_calendar_items WHERE client_id=? AND content_type=? AND status='planned' AND scheduled_date>=? ORDER BY scheduled_date,id LIMIT 1)`,
        ).bind(task.id, task.client_id, type, task.occurred_on).run();
      } else {
        await db.prepare(
          `UPDATE client_calendar_items SET status='published',publish_task_id=?,published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
           WHERE id=(SELECT id FROM client_calendar_items WHERE client_id=? AND content_type=? AND status IN ('ready','link_added','viewed') ORDER BY scheduled_date,id LIMIT 1)`,
        ).bind(task.id, task.client_id, type).run();
      }
    }
  }
}

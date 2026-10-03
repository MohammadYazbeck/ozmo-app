import { authErrorResponse, AuthError, requireAdmin } from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const month = new URL(request.url).searchParams.get("month") ?? "";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AuthError(400, "INVALID_MONTH", "Choose a valid month.");
    const [year, number] = month.split("-").map(Number);
    const start = `${month}-01`;
    const end = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
    const db = getD1();
    const [team, clients, sessions, totals] = await Promise.all([
      db.prepare(`SELECT u.id,u.display_name AS displayName,u.role,
        (SELECT COUNT(*) FROM reports r WHERE r.user_id=u.id AND r.report_date BETWEEN ? AND ? AND r.status='submitted') AS submittedReports,
        (SELECT COUNT(*) FROM missing_report_days m WHERE m.user_id=u.id AND m.report_date BETWEEN ? AND ?) AS missingReports,
        (SELECT COUNT(*) FROM report_penalties p WHERE p.user_id=u.id AND date(p.created_at) BETWEEN ? AND ?) AS deductions,
        (SELECT COALESCE(SUM(p.amount_cents),0) FROM report_penalties p WHERE p.user_id=u.id AND date(p.created_at) BETWEEN ? AND ?) AS deductionCents,
        (SELECT COUNT(*) FROM tasks t JOIN reports r ON r.id=t.report_id WHERE t.user_id=u.id AND t.occurred_on BETWEEN ? AND ? AND r.status='submitted') AS tasks,
        (SELECT COALESCE(SUM(t.quantity),0) FROM tasks t JOIN reports r ON r.id=t.report_id WHERE t.user_id=u.id AND t.occurred_on BETWEEN ? AND ? AND t.status='completed' AND r.status='submitted') AS completedQuantity
        FROM users u WHERE u.is_active=1 AND u.role<>'admin' ORDER BY u.display_name`).bind(start,end,start,end,start,end,start,end,start,end,start,end).all(),
      db.prepare(`SELECT c.id,c.name,
        COUNT(DISTINCT t.id) AS tasks,
        COALESCE(SUM(CASE WHEN t.action='produced' AND t.status='completed' THEN t.quantity ELSE 0 END),0) AS produced,
        COALESCE(SUM(CASE WHEN t.action='published' AND t.status='completed' THEN t.quantity ELSE 0 END),0) AS published,
        COALESCE(SUM(CASE WHEN t.task_type='draft_created' AND t.status='completed' THEN t.quantity ELSE 0 END),0) AS drafts
        FROM clients c LEFT JOIN tasks t ON t.client_id=c.id AND t.occurred_on BETWEEN ? AND ? AND EXISTS (SELECT 1 FROM reports r WHERE r.id=t.report_id AND r.status='submitted')
        WHERE c.is_active=1 GROUP BY c.id ORDER BY c.name`).bind(start,end).all(),
      db.prepare(`SELECT status,COUNT(*) AS count,COALESCE(SUM(reels_shot),0) AS reelsShot,COALESCE(SUM(photos_shot),0) AS photosShot FROM sessions WHERE date(scheduled_for) BETWEEN ? AND ? GROUP BY status`).bind(start,end).all(),
      db.prepare(`SELECT COUNT(DISTINCT r.id) AS reports,COUNT(DISTINCT t.id) AS tasks,COALESCE(SUM(CASE WHEN t.action='produced' THEN t.quantity ELSE 0 END),0) AS produced,COALESCE(SUM(CASE WHEN t.action='published' THEN t.quantity ELSE 0 END),0) AS published FROM reports r LEFT JOIN tasks t ON t.report_id=r.id WHERE r.report_date BETWEEN ? AND ? AND r.status='submitted'`).bind(start,end).first(),
    ]);
    return Response.json({ month, startDate:start, endDate:end, totals, team:team.results, clients:clients.results, sessions:sessions.results }, { headers:{ "Cache-Control":"no-store" } });
  } catch (error) { return authErrorResponse(error); }
}

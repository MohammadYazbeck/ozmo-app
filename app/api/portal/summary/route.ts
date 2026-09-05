import { authErrorResponse } from "@/lib/auth";
import { getD1 } from "@/lib/db";
import { isMonthKey } from "@/lib/portal-contract";
import { requirePortalUser } from "@/lib/portal-auth";

type InventoryRow = {
  shot_reel_count: number;
  reel_count: number;
  post_count: number;
  draft_count: number;
  updated_at: string;
};

type ActivityRow = {
  id: number;
  task_type: string;
  content_type: string | null;
  quantity: number;
  status: string;
  occurred_on: string;
};

type KpiRow = {
  id: number;
  goal: string;
  is_completed: number;
  completed_at: string | null;
};

export async function GET(request: Request) {
  try {
    const user = await requirePortalUser(request);
    const month = new URL(request.url).searchParams.get("month") ?? "";
    if (!isMonthKey(month)) {
      return Response.json(
        { error: "Invalid month." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const database = getD1();
    const monthStart = `${month}-01`;
    const monthEnd = nextMonthStart(month);
    const [inventory, monthly, activity, session, logo, goals] = await Promise.all([
      database
        .prepare(
          `SELECT
             COALESCE(MAX(CASE WHEN content_type='shot_reel' THEN quantity END),0) AS shot_reel_count,
             COALESCE(MAX(CASE WHEN content_type='reel' THEN quantity END),0) AS reel_count,
             COALESCE(MAX(CASE WHEN content_type='post' THEN quantity END),0) AS post_count,
             COALESCE(MAX(CASE WHEN content_type='draft' THEN quantity END),0) AS draft_count,
             COALESCE(MAX(updated_at),CURRENT_TIMESTAMP) AS updated_at
           FROM inventory_balances
           WHERE client_id=?`,
        )
        .bind(user.clientId)
        .first<InventoryRow>(),
      database
        .prepare(
          `SELECT
             COALESCE(SUM(CASE
               WHEN event_type IN ('reel_new','post_new') AND delta>0
               THEN delta ELSE 0 END),0) AS produced,
             COALESCE(SUM(CASE
               WHEN event_type IN ('publish_reel','publish_post') AND delta<0
               THEN -delta ELSE 0 END),0) AS published
           FROM inventory_events
           WHERE client_id=? AND occurred_on>=? AND occurred_on<?`,
        )
        .bind(user.clientId, monthStart, monthEnd)
        .first<{ produced: number; published: number }>(),
      database
        .prepare(
          `SELECT
             t.id,t.task_type,t.content_type,t.quantity,t.status,t.occurred_on
           FROM tasks t
           LEFT JOIN reports r ON r.id=t.report_id
           WHERE t.client_id=?
             AND t.occurred_on>=? AND t.occurred_on<?
             AND (t.report_id IS NULL OR r.status='submitted')
             AND NOT EXISTS (
               SELECT 1 FROM activity_log_hides h
               WHERE h.source_type='task' AND h.source_id=t.id
             )
           ORDER BY t.occurred_on DESC,t.id DESC
           LIMIT 20`,
        )
        .bind(user.clientId, monthStart, monthEnd)
        .all<ActivityRow>(),
      database
        .prepare(
          `SELECT id,scheduled_for,status
           FROM sessions s
           WHERE client_id=? AND status='scheduled'
             AND scheduled_for>=?
             AND NOT EXISTS (
               SELECT 1 FROM session_deletions d WHERE d.session_id=s.id
             )
           ORDER BY scheduled_for
           LIMIT 1`,
        )
        .bind(user.clientId, new Date().toISOString())
        .first<{ id: number; scheduled_for: string; status: string }>(),
      database
        .prepare("SELECT updated_at FROM client_logos WHERE client_id=?")
        .bind(user.clientId)
        .first<{ updated_at: string }>(),
      database
        .prepare(
          `SELECT id,goal,is_completed,completed_at
           FROM client_monthly_kpis
           WHERE client_id=? AND month=?
           ORDER BY id`,
        )
        .bind(user.clientId, month)
        .all<KpiRow>(),
    ]);

    return Response.json(
      {
        client: {
          id: String(user.clientId),
          ozmoClientId: user.ozmoClientId,
          name: user.clientName,
          logoUrl: logo
            ? `/api/client-logo?clientId=${user.clientId}&v=${encodeURIComponent(logo.updated_at)}`
            : null,
        },
        month,
        content: {
          produced: Number(monthly?.produced ?? 0),
          published: Number(monthly?.published ?? 0),
          inventory: {
            drafts: Number(inventory?.draft_count ?? 0),
            shotReels: Number(inventory?.shot_reel_count ?? 0),
            readyReels: Number(inventory?.reel_count ?? 0),
            readyPosts: Number(inventory?.post_count ?? 0),
          },
          updatedAt: inventory?.updated_at ?? new Date().toISOString(),
        },
        upcomingSession: session
          ? {
              id: String(session.id),
              scheduledAt: session.scheduled_for,
              status: session.status,
            }
          : null,
        monthlyKpis: goals.results.map((goal) => ({
          id: String(goal.id),
          goal: goal.goal,
          completed: Boolean(goal.is_completed),
          completedAt: goal.completed_at,
        })),
        recentActivity: activity.results.map((item) => ({
          id: String(item.id),
          action: item.task_type,
          contentType: item.content_type,
          quantity: Number(item.quantity),
          status: item.status,
          occurredOn: item.occurred_on,
        })),
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}

function nextMonthStart(month: string) {
  const [year, number] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, number, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

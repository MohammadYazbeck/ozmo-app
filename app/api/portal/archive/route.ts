import { authErrorResponse } from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import { requirePortalUser } from "@/lib/portal-auth";

type PeriodRow = {
  id: number;
  label: string;
  start_date: string;
  end_date: string;
  closed_at: string;
  notes: string;
  produced: number;
  published: number;
  task_count: number;
};

type SnapshotRow = {
  period_id: number;
  content_type: "draft" | "shot_reel" | "reel" | "post" | "story";
  closing_quantity: number;
  carry_quantity: number;
};

export async function GET(request: Request) {
  try {
    const user = await requirePortalUser(request);
    await ensureDatabase();
    const database = getD1();
    const [periods, snapshots] = await Promise.all([
      database
        .prepare(
          `SELECT
             p.id,p.label,p.start_date,p.end_date,p.closed_at,p.notes,
             (
               SELECT COALESCE(SUM(CASE
                 WHEN e.event_type IN ('reel_new','post_new','story_new','draft_created')
                 THEN e.delta ELSE 0 END),0)
               FROM inventory_events e
               WHERE e.client_id=? AND e.occurred_on BETWEEN p.start_date AND p.end_date
             ) AS produced,
             (
               SELECT COALESCE(SUM(CASE
                 WHEN e.event_type IN ('publish_reel','publish_post','publish_story')
                 THEN -e.delta ELSE 0 END),0)
               FROM inventory_events e
               WHERE e.client_id=? AND e.occurred_on BETWEEN p.start_date AND p.end_date
             ) AS published,
             (
               SELECT COUNT(*) FROM tasks t
               LEFT JOIN reports r ON r.id=t.report_id
               WHERE t.client_id=? AND t.occurred_on BETWEEN p.start_date AND p.end_date
                 AND (t.report_id IS NULL OR r.status='submitted')
             ) AS task_count
           FROM inventory_periods p
           ORDER BY p.label DESC`,
        )
        .bind(user.clientId, user.clientId, user.clientId)
        .all<PeriodRow>(),
      database
        .prepare(
          `SELECT
             s.period_id,s.content_type,s.closing_quantity,s.carry_quantity
           FROM inventory_period_snapshots s
           WHERE s.client_id=?
           ORDER BY s.period_id DESC,s.content_type`,
        )
        .bind(user.clientId)
        .all<SnapshotRow>(),
    ]);

    const snapshotsByPeriod = new Map<number, SnapshotRow[]>();
    for (const snapshot of snapshots.results) {
      const rows = snapshotsByPeriod.get(snapshot.period_id) ?? [];
      rows.push(snapshot);
      snapshotsByPeriod.set(snapshot.period_id, rows);
    }

    return Response.json(
      {
        archives: periods.results.map((period) => {
          const inventory = snapshotsByPeriod.get(period.id) ?? [];
          const byType = new Map(
            inventory.map((item) => [item.content_type, item]),
          );
          return {
            id: String(period.id),
            month: period.label,
            startDate: period.start_date,
            endDate: period.end_date,
            closedAt: period.closed_at,
            notes: period.notes,
            taskCount: Number(period.task_count),
            content: {
              produced: Number(period.produced),
              published: Number(period.published),
            },
            inventory: {
              drafts: Number(byType.get("draft")?.closing_quantity ?? 0),
              shotReels: Number(byType.get("shot_reel")?.closing_quantity ?? 0),
              readyReels: Number(byType.get("reel")?.closing_quantity ?? 0),
              readyPosts: Number(byType.get("post")?.closing_quantity ?? 0),
              readyStories: Number(byType.get("story")?.closing_quantity ?? 0),
            },
            carry: {
              drafts: Number(byType.get("draft")?.carry_quantity ?? 0),
              shotReels: Number(byType.get("shot_reel")?.carry_quantity ?? 0),
              readyReels: Number(byType.get("reel")?.carry_quantity ?? 0),
              readyPosts: Number(byType.get("post")?.carry_quantity ?? 0),
              readyStories: Number(byType.get("story")?.carry_quantity ?? 0),
            },
          };
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}

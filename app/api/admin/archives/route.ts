import {
  AuthError,
  authErrorResponse,
  requireAdmin,
} from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import { damascusDate } from "@/lib/time";

type PeriodRow = {
  id: number;
  label: string;
  start_date: string;
  end_date: string;
  closed_at: string;
  notes: string;
  closed_by_name: string;
  task_count: number;
  report_count: number;
};

type SnapshotRow = {
  period_id: number;
  client_id: number;
  client_name: string;
  content_type: "reel" | "shot_reel" | "post" | "story" | "draft";
  closing_quantity: number;
  carry_quantity: number;
  reset_delta: number;
};

type BalanceRow = {
  client_id: number;
  client_name: string;
  content_type: "reel" | "shot_reel" | "post" | "story" | "draft";
  quantity: number;
};

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const database = getD1();
    const [periods, snapshots] = await Promise.all([
      database
        .prepare(
          `SELECT
             p.id,p.label,p.start_date,p.end_date,p.closed_at,p.notes,
             u.display_name AS closed_by_name,
             (
               SELECT COUNT(*) FROM tasks t
               WHERE t.occurred_on BETWEEN p.start_date AND p.end_date
             ) AS task_count,
             (
               SELECT COUNT(*) FROM reports r
               WHERE r.report_date BETWEEN p.start_date AND p.end_date
                 AND r.status='submitted'
             ) AS report_count
           FROM inventory_periods p
           JOIN users u ON u.id=p.closed_by_user_id
           ORDER BY p.label DESC`,
        )
        .all<PeriodRow>(),
      database
        .prepare(
          `SELECT
             s.period_id,s.client_id,c.name AS client_name,s.content_type,
             s.closing_quantity,s.carry_quantity,s.reset_delta
           FROM inventory_period_snapshots s
           JOIN clients c ON c.id=s.client_id
           ORDER BY s.period_id DESC,c.name,s.content_type`,
        )
        .all<SnapshotRow>(),
    ]);
    const rowsByPeriod = new Map<number, SnapshotRow[]>();
    for (const row of snapshots.results) {
      const rows = rowsByPeriod.get(row.period_id) ?? [];
      rows.push(row);
      rowsByPeriod.set(row.period_id, rows);
    }
    return Response.json(
      {
        archives: periods.results.map((period) => ({
          id: String(period.id),
          month: period.label,
          startDate: period.start_date,
          endDate: period.end_date,
          closedAt: period.closed_at,
          closedByName: period.closed_by_name,
          notes: period.notes,
          taskCount: Number(period.task_count),
          reportCount: Number(period.report_count),
          inventory: (rowsByPeriod.get(period.id) ?? []).map((row) => ({
            clientId: String(row.client_id),
            clientName: row.client_name,
            contentType: row.content_type,
            closingQuantity: Number(row.closing_quantity),
            carryQuantity: Number(row.carry_quantity),
            resetDelta: Number(row.reset_delta),
          })),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request);
    await ensureDatabase();
    const body = (await request.json().catch(() => null)) as {
      month?: unknown;
      notes?: unknown;
      carry?: Array<{
        clientId?: unknown;
        reel?: unknown;
        shotReel?: unknown;
        post?: unknown;
        story?: unknown;
        draft?: unknown;
      }>;
    } | null;
    const month =
      typeof body?.month === "string" ? body.month.trim() : "";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new AuthError(
        400,
        "INVALID_ARCHIVE_MONTH",
        "Choose a valid month to archive.",
      );
    }
    if (month > damascusDate().slice(0, 7)) {
      throw new AuthError(
        400,
        "FUTURE_ARCHIVE_MONTH",
        "A future month cannot be archived.",
      );
    }
    const notes =
      typeof body?.notes === "string" ? body.notes.trim() : "";
    if (notes.length > 1_000) {
      throw new AuthError(
        400,
        "ARCHIVE_NOTES_TOO_LONG",
        "The optional archive notes must be 1,000 characters or fewer.",
      );
    }
    if (!Array.isArray(body?.carry)) {
      throw new AuthError(
        400,
        "MISSING_CARRY_COUNTS",
        "Review the carry-over count for every client.",
      );
    }

    const database = getD1();
    const existing = await database
      .prepare("SELECT id FROM inventory_periods WHERE label=? LIMIT 1")
      .bind(month)
      .first<{ id: number }>();
    if (existing) {
      throw new AuthError(
        409,
        "MONTH_ALREADY_ARCHIVED",
        "This month has already been archived.",
      );
    }

    const balances = await database
      .prepare(
        `SELECT
           b.client_id,c.name AS client_name,b.content_type,b.quantity
         FROM inventory_balances b
         JOIN clients c ON c.id=b.client_id
         WHERE c.is_active=1
         ORDER BY c.id,b.content_type`,
      )
      .all<BalanceRow>();
    const supplied = new Map<
      number,
      { reel: number; shot_reel: number; post: number; story: number; draft: number }
    >();
    for (const entry of body.carry) {
      const clientId = Number(entry.clientId);
      if (!Number.isSafeInteger(clientId) || clientId <= 0) {
        throw new AuthError(
          400,
          "INVALID_CARRY_COUNTS",
          "Every carry-over row needs a valid client.",
        );
      }
      if (supplied.has(clientId)) {
        throw new AuthError(
          400,
          "DUPLICATE_CARRY_CLIENT",
          "Each client can appear only once in the carry-over list.",
        );
      }
      const counts = {
        reel: Number(entry.reel),
        shot_reel: Number(entry.shotReel),
        post: Number(entry.post),
        story: Number(entry.story ?? 0),
        draft: Number(entry.draft),
      };
      if (
        Object.values(counts).some(
          (value) =>
            !Number.isSafeInteger(value) || value < 0 || value > 100_000,
        )
      ) {
        throw new AuthError(
          400,
          "INVALID_CARRY_COUNTS",
          "Carry-over counts must be zero or positive whole numbers.",
        );
      }
      supplied.set(clientId, counts);
    }
    const activeClientIds = new Set(
      balances.results.map((row) => Number(row.client_id)),
    );
    if (
      supplied.size !== activeClientIds.size ||
      [...activeClientIds].some((clientId) => !supplied.has(clientId))
    ) {
      throw new AuthError(
        400,
        "INCOMPLETE_CARRY_COUNTS",
        "Review the carry-over count for every active client before closing the month.",
      );
    }

    const carryRows = balances.results.map((balance) => {
      const clientCounts = supplied.get(balance.client_id)!;
      const carryQuantity = clientCounts[balance.content_type];
      if (carryQuantity > balance.quantity) {
        throw new AuthError(
          409,
          "CARRY_EXCEEDS_BALANCE",
          `${balance.client_name} has only ${balance.quantity} ${balance.content_type}(s) available.`,
        );
      }
      return { ...balance, carryQuantity };
    });

    const [year, monthNumber] = month.split("-").map(Number);
    const startDate = `${month}-01`;
    const endDate = new Date(Date.UTC(year, monthNumber, 0))
      .toISOString()
      .slice(0, 10);
    const occurredOn = damascusDate();
    const snapshotStatements: D1PreparedStatement[] = [];
    const resetStatements: D1PreparedStatement[] = [];
    const touchedClients = new Set<number>();

    for (const row of carryRows) {
      snapshotStatements.push(
        database
          .prepare(
            `INSERT INTO inventory_period_snapshots
               (period_id,client_id,content_type,closing_quantity,
                carry_quantity,reset_delta)
             SELECT
               p.id,b.client_id,b.content_type,b.quantity,?,?-b.quantity
             FROM inventory_periods p
             JOIN inventory_balances b
               ON b.client_id=? AND b.content_type=?
             WHERE p.label=?`,
          )
          .bind(
            row.carryQuantity,
            row.carryQuantity,
            row.client_id,
            row.content_type,
            month,
          ),
      );
      if (row.carryQuantity === row.quantity) continue;
      resetStatements.push(
        database
          .prepare(
            `INSERT INTO inventory_events
               (client_id,content_type,delta,event_type,actor_user_id,note,occurred_on)
             SELECT
               client_id,content_type,?-quantity,'month_close_reset',?,?,?
             FROM inventory_balances
             WHERE client_id=? AND content_type=?`,
          )
          .bind(
            row.carryQuantity,
            admin.id,
            `Month ${month} archived; ${row.carryQuantity} carried forward.`,
            occurredOn,
            row.client_id,
            row.content_type,
          ),
        database
          .prepare(
            `UPDATE inventory_balances
             SET quantity=?,updated_at=CURRENT_TIMESTAMP
             WHERE client_id=? AND content_type=?`,
          )
          .bind(row.carryQuantity, row.client_id, row.content_type),
      );
      touchedClients.add(row.client_id);
    }

    const statements: D1PreparedStatement[] = [
      database
        .prepare(
          `INSERT INTO inventory_periods
             (label,start_date,end_date,closed_by_user_id,notes)
           VALUES (?,?,?,?,?)`,
        )
        .bind(month, startDate, endDate, admin.id, notes),
      ...snapshotStatements,
      ...resetStatements,
      ...[...touchedClients].map((clientId) =>
        database
          .prepare("UPDATE clients SET updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(clientId),
      ),
    ];
    try {
      await database.batch(statements);
    } catch (error) {
      const message = String(error).toLowerCase();
      if (message.includes("unique")) {
        throw new AuthError(
          409,
          "MONTH_ALREADY_ARCHIVED",
          "This month has already been archived.",
        );
      }
      if (message.includes("check constraint")) {
        throw new AuthError(
          409,
          "INVENTORY_CHANGED",
          "Inventory changed while the month was closing. Refresh and review the carry-over counts.",
        );
      }
      throw error;
    }

    return Response.json(
      { ok: true, month, archivedAt: new Date().toISOString() },
      { status: 201 },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}

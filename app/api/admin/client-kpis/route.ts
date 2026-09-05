import { AuthError, authErrorResponse, requireAdmin } from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import { isMonthKey } from "@/lib/portal-contract";

type KpiRow = {
  id: number;
  client_id: number;
  month: string;
  goal: string;
  is_completed: number;
  completed_at: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const url = new URL(request.url);
    const clientId = validClientId(url.searchParams.get("clientId"));
    const month = validMonth(url.searchParams.get("month"));
    await requireActiveClient(clientId);
    const rows = await getD1()
      .prepare(
        `SELECT id,client_id,month,goal,is_completed,completed_at,created_at
         FROM client_monthly_kpis
         WHERE client_id=? AND month=?
         ORDER BY id`,
      )
      .bind(clientId, month)
      .all<KpiRow>();
    return Response.json({ goals: rows.results.map(serializeKpi) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const body = (await request.json().catch(() => null)) as {
      clientId?: unknown;
      month?: unknown;
      goal?: unknown;
    } | null;
    const clientId = validClientId(body?.clientId);
    const month = validMonth(body?.month);
    const goal = validGoal(body?.goal);
    await requireActiveClient(clientId);
    const result = await getD1()
      .prepare(
        `INSERT INTO client_monthly_kpis (client_id,month,goal)
         VALUES (?,?,?)`,
      )
      .bind(clientId, month, goal)
      .run();
    const created = await getD1()
      .prepare(
        `SELECT id,client_id,month,goal,is_completed,completed_at,created_at
         FROM client_monthly_kpis WHERE id=?`,
      )
      .bind(result.meta.last_row_id)
      .first<KpiRow>();
    return Response.json({ goal: serializeKpi(created!) }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
      completed?: unknown;
    } | null;
    const id = Number(body?.id);
    if (!Number.isSafeInteger(id) || id < 1 || typeof body?.completed !== "boolean") {
      throw new AuthError(400, "INVALID_KPI", "Choose a valid KPI goal.");
    }
    const result = await getD1()
      .prepare(
        `UPDATE client_monthly_kpis
         SET is_completed=?,completed_at=?,updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
      )
      .bind(body.completed ? 1 : 0, body.completed ? new Date().toISOString() : null, id)
      .run();
    if (!result.meta.changes) {
      throw new AuthError(404, "KPI_NOT_FOUND", "That KPI goal was not found.");
    }
    return Response.json({ updated: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    const id = Number(body?.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new AuthError(400, "INVALID_KPI", "Choose a valid KPI goal.");
    }
    const result = await getD1()
      .prepare("DELETE FROM client_monthly_kpis WHERE id=?")
      .bind(id)
      .run();
    if (!result.meta.changes) {
      throw new AuthError(404, "KPI_NOT_FOUND", "That KPI goal was not found.");
    }
    return Response.json({ removed: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

function validClientId(value: unknown) {
  const clientId = Number(value);
  if (!Number.isSafeInteger(clientId) || clientId < 1) {
    throw new AuthError(400, "INVALID_CLIENT", "Choose a valid client.");
  }
  return clientId;
}

function validMonth(value: unknown) {
  if (typeof value !== "string" || !isMonthKey(value)) {
    throw new AuthError(400, "INVALID_MONTH", "Choose a valid month.");
  }
  return value;
}

function validGoal(value: unknown) {
  if (typeof value !== "string") {
    throw new AuthError(400, "INVALID_KPI_GOAL", "Enter a KPI goal.");
  }
  const goal = value.trim().replace(/\s+/g, " ");
  if (goal.length < 3 || goal.length > 240) {
    throw new AuthError(400, "INVALID_KPI_GOAL", "KPI goals must contain 3–240 characters.");
  }
  return goal;
}

async function requireActiveClient(clientId: number) {
  const client = await getD1()
    .prepare("SELECT id FROM clients WHERE id=? AND is_active=1")
    .bind(clientId)
    .first<{ id: number }>();
  if (!client) {
    throw new AuthError(404, "CLIENT_NOT_FOUND", "That active client was not found.");
  }
}

function serializeKpi(row: KpiRow) {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    month: row.month,
    goal: row.goal,
    completed: Boolean(row.is_completed),
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

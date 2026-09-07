import {
  AuthError,
  authErrorResponse,
  requireAdmin,
  requireUser,
} from "@/lib/auth";
import { ensureDatabase, getD1, nextOzmoClientId } from "@/lib/db";

type ClientInventoryRow = {
  id: number;
  ozmo_client_id: string;
  name: string;
  session_reel_threshold: number;
  remaining_payment_cents: number;
  remaining_payment_currency: string;
  google_drive_url: string | null;
  updated_at: string;
  shot_reel_count: number;
  reel_count: number;
  post_count: number;
  story_count: number;
  draft_count: number;
  logo_updated_at: string | null;
};

type ExistingClientRow = {
  id: number;
  ozmo_client_id: string | null;
  is_active: number;
};

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const canViewAllInventory =
      ["admin", "account_manager", "content_manager"].includes(user.role);
    const canViewReelInventory =
      canViewAllInventory || user.role === "editor";
    await ensureDatabase();
    const database = getD1();
    const [rows, settings] = await Promise.all([
      database
        .prepare(
          `SELECT
             c.id,c.ozmo_client_id,c.name,c.session_reel_threshold,
             c.remaining_payment_cents,c.remaining_payment_currency,c.google_drive_url,c.updated_at,
             COALESCE(MAX(CASE WHEN b.content_type='shot_reel' THEN b.quantity END),0) AS shot_reel_count,
             COALESCE(MAX(CASE WHEN b.content_type='reel' THEN b.quantity END),0) AS reel_count,
             COALESCE(MAX(CASE WHEN b.content_type='post' THEN b.quantity END),0) AS post_count,
             COALESCE(MAX(CASE WHEN b.content_type='story' THEN b.quantity END),0) AS story_count,
             COALESCE(MAX(CASE WHEN b.content_type='draft' THEN b.quantity END),0) AS draft_count,
             (SELECT updated_at FROM client_logos l WHERE l.client_id=c.id) AS logo_updated_at
           FROM clients c
           LEFT JOIN inventory_balances b ON b.client_id=c.id
           WHERE c.is_active=1
           GROUP BY c.id,c.ozmo_client_id,c.name,c.session_reel_threshold,
                    c.remaining_payment_cents,c.remaining_payment_currency,c.google_drive_url,c.updated_at
           ORDER BY c.id`,
        )
        .all<ClientInventoryRow>(),
      database
        .prepare(
          `SELECT key,value FROM settings
           WHERE key IN ('inventory_ready','low_post_threshold','low_draft_threshold')`,
        )
        .all<{ key: string; value: string }>(),
    ]);
    const map = new Map(settings.results.map((item) => [item.key, item.value]));
    const inventoryReady = map.get("inventory_ready") === "true";
    const postThreshold = parseOptionalNumber(map.get("low_post_threshold"));
    const draftThreshold = parseOptionalNumber(map.get("low_draft_threshold"));

    return Response.json({
      inventoryReady: canViewReelInventory && inventoryReady,
      clients: rows.results.map((client) => ({
        id: String(client.id),
        ozmoClientId: client.ozmo_client_id,
        name: client.name,
        shotReelCount: canViewReelInventory
          ? Number(client.shot_reel_count)
          : 0,
        reelCount: canViewReelInventory ? Number(client.reel_count) : 0,
        postCount: canViewAllInventory ? Number(client.post_count) : 0,
        storyCount: canViewAllInventory ? Number(client.story_count) : 0,
        draftCount: canViewAllInventory ? Number(client.draft_count) : 0,
        sessionThreshold: client.session_reel_threshold,
        remainingPaymentCents: Number(client.remaining_payment_cents ?? 0),
        remainingPaymentCurrency: client.remaining_payment_currency || "USD",
        googleDriveUrl: client.google_drive_url,
        postThreshold: canViewAllInventory ? postThreshold : null,
        draftThreshold: canViewAllInventory ? draftThreshold : null,
        needsSession:
          canViewReelInventory &&
          inventoryReady &&
          Number(client.reel_count) + Number(client.shot_reel_count) <=
            client.session_reel_threshold,
        updatedAt: client.updated_at,
        logoUrl: clientLogoUrl(client.id, client.logo_updated_at),
      })),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      sessionThreshold?: unknown;
    } | null;
    if (!body || typeof body.name !== "string") {
      throw new AuthError(400, "INVALID_CLIENT_NAME", "Enter a client name.");
    }
    const name = body.name.trim().replace(/\s+/g, " ").toUpperCase();
    if (
      name.length < 2 ||
      name.length > 80 ||
      /[\u0000-\u001f\u007f]/.test(name)
    ) {
      throw new AuthError(
        400,
        "INVALID_CLIENT_NAME",
        "Client name must contain 2–80 visible characters.",
      );
    }
    if (name === "OTHER") {
      throw new AuthError(
        400,
        "RESERVED_CLIENT_NAME",
        "Other is reserved for non-client work. Enter the real client name instead.",
      );
    }
    const sessionThreshold =
      body.sessionThreshold === undefined
        ? 4
        : Number(body.sessionThreshold);
    if (
      !Number.isSafeInteger(sessionThreshold) ||
      sessionThreshold < 0 ||
      sessionThreshold > 100
    ) {
      throw new AuthError(
        400,
        "INVALID_SESSION_THRESHOLD",
        "Session threshold must be a whole number from 0 to 100.",
      );
    }

    const database = getD1();
    const existing = await database
      .prepare(
        `SELECT id,ozmo_client_id,is_active
         FROM clients
         WHERE name = ? COLLATE NOCASE
         LIMIT 1`,
      )
      .bind(name)
      .first<ExistingClientRow>();
    if (existing?.is_active) {
      throw new AuthError(
        409,
        "CLIENT_EXISTS",
        "A client with this name already exists.",
      );
    }

    try {
      const ozmoClientId = existing?.ozmo_client_id ?? await nextOzmoClientId(database);
      if (existing) {
        await database.batch([
          database
            .prepare(
              `UPDATE clients
               SET is_active=1,ozmo_client_id=?,session_reel_threshold=?,updated_at=CURRENT_TIMESTAMP
               WHERE id=? AND is_active=0`,
            )
            .bind(ozmoClientId, sessionThreshold, existing.id),
          ...(["draft", "shot_reel", "reel", "post", "story"] as const).map((contentType) =>
            database
              .prepare(
                `INSERT OR IGNORE INTO inventory_balances
                   (client_id,content_type,quantity)
                 VALUES (?,?,0)`,
              )
              .bind(existing.id, contentType),
          ),
        ]);
      } else {
        await database.batch([
          database
            .prepare(
              `INSERT INTO clients (ozmo_client_id,name,session_reel_threshold)
               VALUES (?,?,?)`,
            )
            .bind(ozmoClientId, name, sessionThreshold),
          ...(["draft", "shot_reel", "reel", "post", "story"] as const).map((contentType) =>
            database
              .prepare(
                `INSERT INTO inventory_balances
                 (client_id,content_type,quantity)
                 SELECT id,?,0 FROM clients
                 WHERE name=? COLLATE NOCASE`,
              )
              .bind(contentType, name),
          ),
        ]);
      }
    } catch (error) {
      if (String(error).toLowerCase().includes("unique")) {
        throw new AuthError(
          409,
          "CLIENT_EXISTS",
          "A client with this name already exists.",
        );
      }
      throw error;
    }

    const created = await database
      .prepare(
        `SELECT
           c.id,c.ozmo_client_id,c.name,c.session_reel_threshold,
           c.remaining_payment_cents,c.remaining_payment_currency,c.google_drive_url,c.updated_at,
           COALESCE(MAX(CASE WHEN b.content_type='shot_reel' THEN b.quantity END),0) AS shot_reel_count,
           COALESCE(MAX(CASE WHEN b.content_type='reel' THEN b.quantity END),0) AS reel_count,
           COALESCE(MAX(CASE WHEN b.content_type='post' THEN b.quantity END),0) AS post_count,
           COALESCE(MAX(CASE WHEN b.content_type='story' THEN b.quantity END),0) AS story_count,
           COALESCE(MAX(CASE WHEN b.content_type='draft' THEN b.quantity END),0) AS draft_count,
           (SELECT updated_at FROM client_logos l WHERE l.client_id=c.id) AS logo_updated_at
         FROM clients c
         LEFT JOIN inventory_balances b ON b.client_id=c.id
         WHERE c.name=? COLLATE NOCASE AND c.is_active=1
         GROUP BY c.id,c.ozmo_client_id,c.name,c.session_reel_threshold,
                  c.remaining_payment_cents,c.remaining_payment_currency,c.google_drive_url,c.updated_at
         LIMIT 1`,
      )
      .bind(name)
      .first<ClientInventoryRow>();
    if (!created) throw new Error("The new client could not be loaded.");

    return Response.json(
      {
        client: {
          id: String(created.id),
          ozmoClientId: created.ozmo_client_id,
          name: created.name,
          shotReelCount: Number(created.shot_reel_count),
          reelCount: Number(created.reel_count),
          postCount: Number(created.post_count),
          storyCount: Number(created.story_count),
          draftCount: Number(created.draft_count),
          sessionThreshold: created.session_reel_threshold,
          remainingPaymentCents: Number(created.remaining_payment_cents ?? 0),
          remainingPaymentCurrency: created.remaining_payment_currency || "USD",
          googleDriveUrl: created.google_drive_url,
          needsSession: false,
          updatedAt: created.updated_at,
          logoUrl: clientLogoUrl(created.id, created.logo_updated_at),
        },
        restored: Boolean(existing),
      },
      { status: existing ? 200 : 201 },
    );
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
      name?: unknown;
      sessionThreshold?: unknown;
      remainingPaymentCents?: unknown;
      remainingPaymentCurrency?: unknown;
      googleDriveUrl?: unknown;
    } | null;
    const clientId = Number(body?.id);
    if (!Number.isSafeInteger(clientId) || clientId < 1) {
      throw new AuthError(400, "INVALID_CLIENT", "Choose a valid client to edit.");
    }
    const name =
      typeof body?.name === "string"
        ? body.name.trim().replace(/\s+/g, " ").toUpperCase()
        : "";
    if (name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new AuthError(
        400,
        "INVALID_CLIENT_NAME",
        "Client name must contain 2–80 visible characters.",
      );
    }
    if (name === "OTHER") {
      throw new AuthError(
        400,
        "RESERVED_CLIENT_NAME",
        "Other is reserved for non-client work. Enter the real client name instead.",
      );
    }
    const sessionThreshold = Number(body?.sessionThreshold);
    if (
      !Number.isSafeInteger(sessionThreshold) ||
      sessionThreshold < 0 ||
      sessionThreshold > 100
    ) {
      throw new AuthError(
        400,
        "INVALID_SESSION_THRESHOLD",
        "Session threshold must be a whole number from 0 to 100.",
      );
    }
    const remainingPaymentCents = Number(body?.remainingPaymentCents ?? 0);
    if (
      !Number.isSafeInteger(remainingPaymentCents) ||
      remainingPaymentCents < 0 ||
      remainingPaymentCents > 100_000_000_00
    ) {
      throw new AuthError(
        400,
        "INVALID_REMAINING_PAYMENT",
        "Remaining payment must be a non-negative amount.",
      );
    }
    const remainingPaymentCurrency =
      typeof body?.remainingPaymentCurrency === "string"
        ? body.remainingPaymentCurrency.trim().toUpperCase()
        : "USD";
    if (!/^[A-Z]{3}$/.test(remainingPaymentCurrency)) {
      throw new AuthError(
        400,
        "INVALID_PAYMENT_CURRENCY",
        "Choose a valid three-letter payment currency.",
      );
    }

    const database = getD1();
    const existing = await database
      .prepare("SELECT id FROM clients WHERE id=? AND is_active=1 LIMIT 1")
      .bind(clientId)
      .first<{ id: number }>();
    if (!existing) {
      throw new AuthError(404, "CLIENT_NOT_FOUND", "That active client was not found.");
    }
    const duplicate = await database
      .prepare(
        "SELECT id FROM clients WHERE name=? COLLATE NOCASE AND id<>? LIMIT 1",
      )
      .bind(name, clientId)
      .first<{ id: number }>();
    if (duplicate) {
      throw new AuthError(409, "CLIENT_EXISTS", "A client with this name already exists.");
    }
    await database
      .prepare(
        `UPDATE clients
         SET name=?,session_reel_threshold=?,remaining_payment_cents=?,
          remaining_payment_currency=?,updated_at=CURRENT_TIMESTAMP
             ,google_drive_url=?
         WHERE id=? AND is_active=1`,
      )
      .bind(
        name,
        sessionThreshold,
        remainingPaymentCents,
        remainingPaymentCurrency,
        normalizeGoogleDriveUrl(body?.googleDriveUrl),
        clientId,
      )
      .run();

    const updated = await database
      .prepare(
        `SELECT
           c.id,c.ozmo_client_id,c.name,c.session_reel_threshold,
           c.remaining_payment_cents,c.remaining_payment_currency,c.google_drive_url,c.updated_at,
           COALESCE(MAX(CASE WHEN b.content_type='shot_reel' THEN b.quantity END),0) AS shot_reel_count,
           COALESCE(MAX(CASE WHEN b.content_type='reel' THEN b.quantity END),0) AS reel_count,
           COALESCE(MAX(CASE WHEN b.content_type='post' THEN b.quantity END),0) AS post_count,
           COALESCE(MAX(CASE WHEN b.content_type='story' THEN b.quantity END),0) AS story_count,
           COALESCE(MAX(CASE WHEN b.content_type='draft' THEN b.quantity END),0) AS draft_count,
           (SELECT updated_at FROM client_logos l WHERE l.client_id=c.id) AS logo_updated_at
         FROM clients c
         LEFT JOIN inventory_balances b ON b.client_id=c.id
         WHERE c.id=? AND c.is_active=1
         GROUP BY c.id,c.ozmo_client_id,c.name,c.session_reel_threshold,
                  c.remaining_payment_cents,c.remaining_payment_currency,c.google_drive_url,c.updated_at
         LIMIT 1`,
      )
      .bind(clientId)
      .first<ClientInventoryRow>();
    if (!updated) throw new Error("The client could not be loaded after editing.");
    return Response.json({
      client: {
        id: String(updated.id),
        ozmoClientId: updated.ozmo_client_id,
        name: updated.name,
        shotReelCount: Number(updated.shot_reel_count),
        reelCount: Number(updated.reel_count),
        postCount: Number(updated.post_count),
        storyCount: Number(updated.story_count),
        draftCount: Number(updated.draft_count),
        sessionThreshold: updated.session_reel_threshold,
        remainingPaymentCents: Number(updated.remaining_payment_cents ?? 0),
        remainingPaymentCurrency: updated.remaining_payment_currency || "USD",
        googleDriveUrl: updated.google_drive_url,
        needsSession: false,
        updatedAt: updated.updated_at,
        logoUrl: clientLogoUrl(updated.id, updated.logo_updated_at),
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
    } | null;
    const clientId = Number(body?.id);
    if (!Number.isSafeInteger(clientId) || clientId < 1) {
      throw new AuthError(
        400,
        "INVALID_CLIENT",
        "Choose a valid client to remove.",
      );
    }

    const database = getD1();
    const client = await database
      .prepare(
        `SELECT
           c.id,c.ozmo_client_id,c.name,c.session_reel_threshold,c.updated_at,
           COALESCE(MAX(CASE WHEN b.content_type='shot_reel' THEN b.quantity END),0) AS shot_reel_count,
           COALESCE(MAX(CASE WHEN b.content_type='reel' THEN b.quantity END),0) AS reel_count,
           COALESCE(MAX(CASE WHEN b.content_type='post' THEN b.quantity END),0) AS post_count,
           COALESCE(MAX(CASE WHEN b.content_type='story' THEN b.quantity END),0) AS story_count,
           COALESCE(MAX(CASE WHEN b.content_type='draft' THEN b.quantity END),0) AS draft_count,
           (SELECT updated_at FROM client_logos l WHERE l.client_id=c.id) AS logo_updated_at
         FROM clients c
         LEFT JOIN inventory_balances b ON b.client_id=c.id
         WHERE c.id=? AND c.is_active=1
         GROUP BY c.id,c.ozmo_client_id,c.name,c.session_reel_threshold,c.updated_at
         LIMIT 1`,
      )
      .bind(clientId)
      .first<ClientInventoryRow>();
    if (!client) {
      throw new AuthError(
        404,
        "CLIENT_NOT_FOUND",
        "That active client was not found.",
      );
    }

    const [draftTask, scheduledSession] = await Promise.all([
      database
        .prepare(
          `SELECT t.id
           FROM tasks t
           JOIN reports r ON r.id=t.report_id
           WHERE t.client_id=? AND r.status='draft'
           LIMIT 1`,
        )
        .bind(clientId)
        .first<{ id: number }>(),
      database
        .prepare(
          `SELECT s.id
           FROM sessions s
           WHERE s.client_id=? AND s.status='scheduled'
             AND NOT EXISTS (
               SELECT 1 FROM session_deletions d WHERE d.session_id=s.id
             )
           LIMIT 1`,
        )
        .bind(clientId)
        .first<{ id: number }>(),
    ]);
    if (draftTask) {
      throw new AuthError(
        409,
        "CLIENT_HAS_DRAFT_WORK",
        "This client is used in an unfinished staff report. Submit or update that draft before removing the client.",
      );
    }
    if (scheduledSession) {
      throw new AuthError(
        409,
        "CLIENT_HAS_UPCOMING_SESSION",
        "This client has an upcoming session. Complete, cancel, or remove the session first.",
      );
    }

    await database.batch([
      database
        .prepare(
          `UPDATE clients
           SET is_active=0,updated_at=CURRENT_TIMESTAMP
           WHERE id=? AND is_active=1`,
        )
        .bind(clientId),
      database
        .prepare(
          `UPDATE notification_states
           SET active=0,last_value=NULL,updated_at=CURRENT_TIMESTAMP
           WHERE key LIKE ? OR key=?`,
        )
        .bind(`low:${clientId}:%`, `session-needed:${clientId}`),
    ]);

    return Response.json({
      ok: true,
      removed: {
        id: String(client.id),
        ozmoClientId: client.ozmo_client_id,
        name: client.name,
        shotReelCount: Number(client.shot_reel_count),
        reelCount: Number(client.reel_count),
        postCount: Number(client.post_count),
        storyCount: Number(client.story_count),
        draftCount: Number(client.draft_count),
      },
      historyPreserved: true,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function clientLogoUrl(clientId: number, updatedAt: string | null) {
  if (!updatedAt) return null;
  return `/api/client-logo?clientId=${clientId}&v=${encodeURIComponent(updatedAt)}`;
}

function normalizeGoogleDriveUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const candidate = value.trim();
  if (candidate.length > 2000) {
    throw new AuthError(400, "INVALID_GOOGLE_DRIVE_URL", "The Google Drive link is too long.");
  }
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || (hostname !== "google.com" && !hostname.endsWith(".google.com"))) {
      throw new Error("invalid host");
    }
    return url.toString();
  } catch {
    throw new AuthError(400, "INVALID_GOOGLE_DRIVE_URL", "Enter a valid HTTPS Google Drive link.");
  }
}

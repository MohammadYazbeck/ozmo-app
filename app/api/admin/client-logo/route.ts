import {
  AuthError,
  authErrorResponse,
  requireAdmin,
} from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const form = await request.formData();
    const clientId = validClientId(form.get("clientId"));
    const file = form.get("logo");

    if (!(file instanceof File)) {
      throw new AuthError(400, "LOGO_REQUIRED", "Choose a PNG logo to upload.");
    }
    if (file.type !== "image/png") {
      throw new AuthError(400, "PNG_REQUIRED", "The client logo must be a PNG file.");
    }
    if (file.size < PNG_SIGNATURE.length || file.size > MAX_LOGO_BYTES) {
      throw new AuthError(
        400,
        "INVALID_LOGO_SIZE",
        "The PNG logo must be smaller than 2 MB.",
      );
    }

    const png = new Uint8Array(await file.arrayBuffer());
    if (!PNG_SIGNATURE.every((byte, index) => png[index] === byte)) {
      throw new AuthError(400, "INVALID_PNG", "The selected file is not a valid PNG image.");
    }

    const database = getD1();
    await requireActiveClient(database, clientId);
    const updatedAt = new Date().toISOString();
    await database
      .prepare(
        `INSERT INTO client_logos (client_id,png,byte_size,updated_at)
         VALUES (?,?,?,?)
         ON CONFLICT(client_id) DO UPDATE SET
           png=excluded.png,
           byte_size=excluded.byte_size,
           updated_at=excluded.updated_at`,
      )
      .bind(clientId, png, png.byteLength, updatedAt)
      .run();

    return Response.json({
      ok: true,
      logoUrl: logoUrl(clientId, updatedAt),
      byteSize: png.byteLength,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const clientId = validClientId(new URL(request.url).searchParams.get("clientId"));
    const database = getD1();
    await requireActiveClient(database, clientId);
    const result = await database
      .prepare("DELETE FROM client_logos WHERE client_id=?")
      .bind(clientId)
      .run();

    return Response.json({ ok: true, removed: Number(result.meta.changes ?? 0) > 0 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

function validClientId(value: FormDataEntryValue | string | null) {
  const clientId = Number(value);
  if (!Number.isSafeInteger(clientId) || clientId < 1) {
    throw new AuthError(400, "INVALID_CLIENT", "Choose a valid client.");
  }
  return clientId;
}

async function requireActiveClient(database: D1Database, clientId: number) {
  const client = await database
    .prepare("SELECT id FROM clients WHERE id=? AND is_active=1")
    .bind(clientId)
    .first<{ id: number }>();
  if (!client) {
    throw new AuthError(404, "CLIENT_NOT_FOUND", "That active client was not found.");
  }
}

function logoUrl(clientId: number, updatedAt: string) {
  return `/api/client-logo?clientId=${clientId}&v=${encodeURIComponent(updatedAt)}`;
}

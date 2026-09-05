import { ensureDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabase();
    return Response.json(
      {
        ok: true,
        service: "ozmo-app",
        time: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("OZMO health check failed", error);
    return Response.json(
      { ok: false, service: "ozmo-app" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

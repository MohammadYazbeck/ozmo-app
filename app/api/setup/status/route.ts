import { authErrorResponse, assertOfficeRequest } from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";

type SetupCount = { count: number };
type AdminSetupRow = {
  username: string;
  display_name: string;
};

export async function GET(request: Request) {
  try {
    assertOfficeRequest(request);
    await ensureDatabase();
    const database = getD1();

    const [configured, admins] = await Promise.all([
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM users
           WHERE role = 'admin'
             AND is_active = 1
             AND password_hash IS NOT NULL`,
        )
        .first<SetupCount>(),
      database
        .prepare(
          `SELECT username,display_name
           FROM users
           WHERE role = 'admin'
           ORDER BY id`,
        )
        .all<AdminSetupRow>(),
    ]);

    return Response.json(
      {
        setupRequired: Number(configured?.count ?? 0) === 0,
        company: "OZMO",
        admins: admins.results.map((admin: AdminSetupRow) => ({
          username: admin.username,
          displayName: admin.display_name,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}

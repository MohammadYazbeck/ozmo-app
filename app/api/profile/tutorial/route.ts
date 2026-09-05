import { authErrorResponse, requireUser } from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureDatabase();
    await getD1()
      .prepare(
        `UPDATE users
         SET tutorial_completed=1,updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
      )
      .bind(user.id)
      .run();
    return Response.json({ ok: true, tutorialCompleted: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

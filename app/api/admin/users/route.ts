import { USER_ROLES, type UserRole } from "@/db/schema";
import {
  AuthError,
  authErrorResponse,
  createAuthSession,
  hashPassword,
  requireAdmin,
  validatePassword,
} from "@/lib/auth";
import { getD1 } from "@/lib/db";

type UserRow = {
  id: number;
  username: string;
  display_name: string;
  phone: string;
  role: UserRole;
  is_active: number;
  must_change_password: number;
  tutorial_completed: number;
  password_hash: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

type UserCreateBody = {
  username?: unknown;
  displayName?: unknown;
  phone?: unknown;
  role?: unknown;
  password?: unknown;
  isActive?: unknown;
};

type UserPatchBody = {
  userId?: unknown;
  username?: unknown;
  displayName?: unknown;
  phone?: unknown;
  role?: unknown;
  password?: unknown;
  isActive?: unknown;
  tutorialCompleted?: unknown;
};

type CountRow = { count: number };
type IdRow = { id: number };

const USER_SELECT = `SELECT
  id,username,display_name,phone,role,is_active,must_change_password,
  tutorial_completed,password_hash,last_login_at,created_at,updated_at
 FROM users`;

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/;
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const rows = await getD1()
      .prepare(`${USER_SELECT} ORDER BY is_active DESC, display_name COLLATE NOCASE`)
      .all<UserRow>();
    return Response.json(
      { users: rows.results.map(publicUser) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const body = (await request.json()) as UserCreateBody;
    const username = parseUsername(body.username);
    const displayName = parseDisplayName(body.displayName);
    const phone = parsePhone(body.phone);
    const role = parseRole(body.role);
    const password = parsePassword(body.password);
    const isActive =
      body.isActive === undefined ? true : parseActiveState(body.isActive);

    const database = getD1();
    await ensureUniqueIdentity(database, username, phone);

    let created: IdRow | null;
    try {
      created = await database
        .prepare(
          `INSERT INTO users (
             username,display_name,phone,role,password_hash,is_active,
             must_change_password,tutorial_completed
           )
           VALUES (?,?,?,?,?,?,0,0)
           RETURNING id`,
        )
        .bind(
          username,
          displayName,
          phone,
          role,
          await hashPassword(password),
          isActive ? 1 : 0,
        )
        .first<IdRow>();
    } catch (error) {
      throwIdentityConflict(error);
    }

    if (!created) {
      throw new Error("Created user ID was not returned.");
    }

    const row = await database
      .prepare(`${USER_SELECT} WHERE id = ? LIMIT 1`)
      .bind(created.id)
      .first<UserRow>();
    if (!row) {
      throw new Error("Created user could not be loaded.");
    }

    return Response.json(
      { user: publicUser(row) },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return userRouteErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const administrator = await requireAdmin(request);
    const body = (await request.json()) as UserPatchBody;
    const userId =
      typeof body.userId === "number" && Number.isInteger(body.userId)
        ? body.userId
        : Number.NaN;
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new AuthError(
        400,
        "INVALID_USER",
        "A valid user ID is required.",
      );
    }

    const database = getD1();
    const target = await database
      .prepare(`${USER_SELECT} WHERE id = ? LIMIT 1`)
      .bind(userId)
      .first<UserRow>();
    if (!target) {
      throw new AuthError(404, "USER_NOT_FOUND", "User was not found.");
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let revokeSessions = false;
    let deactivatePushSubscriptions = false;
    let passwordChanged = false;

    let nextUsername = target.username;
    if (body.username !== undefined) {
      nextUsername = parseUsername(body.username);
      if (nextUsername !== target.username) {
        updates.push("username = ?");
        values.push(nextUsername);
      }
    }

    if (body.displayName !== undefined) {
      const displayName = parseDisplayName(body.displayName);
      if (displayName !== target.display_name) {
        updates.push("display_name = ?");
        values.push(displayName);
      }
    }

    let nextPhone = target.phone;
    if (body.phone !== undefined) {
      nextPhone = parsePhone(body.phone);
      if (nextPhone !== target.phone) {
        updates.push("phone = ?");
        values.push(nextPhone);
      }
    }

    let nextRole = target.role;
    if (body.role !== undefined) {
      nextRole = parseRole(body.role);
      if (nextRole !== target.role) {
        if (target.id === administrator.id && nextRole !== "admin") {
          throw new AuthError(
            400,
            "CANNOT_REMOVE_OWN_ADMIN_ROLE",
            "You cannot remove your own administrator access.",
          );
        }
        updates.push("role = ?");
        values.push(nextRole);
      }
    }

    let nextActive = Boolean(target.is_active);
    if (body.isActive !== undefined) {
      nextActive = parseActiveState(body.isActive);
      if (!nextActive && target.id === administrator.id) {
        throw new AuthError(
          400,
          "CANNOT_DEACTIVATE_SELF",
          "You cannot deactivate your own account.",
        );
      }
      if (nextActive !== Boolean(target.is_active)) {
        updates.push("is_active = ?");
        values.push(nextActive ? 1 : 0);
        if (!nextActive) {
          revokeSessions = true;
          deactivatePushSubscriptions = true;
        }
      }
    }

    if (
      target.role === "admin" &&
      Boolean(target.is_active) &&
      (nextRole !== "admin" || !nextActive)
    ) {
      await assertAnotherActiveAdmin(database, target.id);
    }

    if (
      nextUsername !== target.username ||
      nextPhone !== target.phone
    ) {
      await ensureUniqueIdentity(
        database,
        nextUsername,
        nextPhone,
        target.id,
      );
    }

    if (body.password !== undefined) {
      if (typeof body.password !== "string") {
        throw new AuthError(
          400,
          "INVALID_PASSWORD",
          "Password must be text.",
        );
      }
      const passwordError = validatePassword(body.password);
      if (passwordError) {
        throw new AuthError(400, "WEAK_PASSWORD", passwordError);
      }
      updates.push("password_hash = ?", "must_change_password = 0");
      values.push(await hashPassword(body.password));
      revokeSessions = true;
      passwordChanged = true;
    }

    if (body.tutorialCompleted !== undefined) {
      if (typeof body.tutorialCompleted !== "boolean") {
        throw new AuthError(
          400,
          "INVALID_TUTORIAL_STATE",
          "Tutorial state must be true or false.",
        );
      }
      if (
        body.tutorialCompleted !== Boolean(target.tutorial_completed)
      ) {
        updates.push("tutorial_completed = ?");
        values.push(body.tutorialCompleted ? 1 : 0);
      }
    }

    if (updates.length === 0) {
      throw new AuthError(
        400,
        "NO_CHANGES",
        "No profile or access changes were provided.",
      );
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");
    try {
      await database
        .prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
        .bind(...values, target.id)
        .run();
    } catch (error) {
      throwIdentityConflict(error);
    }

    let replacementSessionCookie: string | null = null;
    if (revokeSessions) {
      await database
        .prepare("DELETE FROM auth_sessions WHERE user_id = ?")
        .bind(target.id)
        .run();
      if (passwordChanged && target.id === administrator.id) {
        replacementSessionCookie = await createAuthSession(
          administrator.id,
          request,
        );
      }
    }
    if (deactivatePushSubscriptions) {
      await database
        .prepare(
          `UPDATE push_subscriptions
           SET is_active = 0, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND is_active = 1`,
        )
        .bind(target.id)
        .run();
    }

    const refreshed = await database
      .prepare(`${USER_SELECT} WHERE id = ? LIMIT 1`)
      .bind(target.id)
      .first<UserRow>();
    if (!refreshed) {
      throw new Error("Updated user could not be loaded.");
    }

    const headers = new Headers({ "Cache-Control": "no-store" });
    if (replacementSessionCookie) {
      headers.set("Set-Cookie", replacementSessionCookie);
    }
    return Response.json(
      {
        user: publicUser(refreshed),
        sessionRefreshed: Boolean(replacementSessionCookie),
      },
      { headers },
    );
  } catch (error) {
    return userRouteErrorResponse(error);
  }
}

function parseUsername(value: unknown): string {
  if (typeof value !== "string") {
    throw new AuthError(
      400,
      "INVALID_USERNAME",
      "Username must be text.",
    );
  }
  const supplied = value.trim().toLowerCase();
  // Preserve the roster's canonical spelling while accepting the spelling
  // used once in the supplied employee list.
  const username = supplied === "zied" ? "zeid" : supplied;
  if (!USERNAME_PATTERN.test(username)) {
    throw new AuthError(
      400,
      "INVALID_USERNAME",
      "Username must be 3–40 characters using letters, numbers, dots, dashes, or underscores.",
    );
  }
  return username;
}

function parseDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw new AuthError(
      400,
      "INVALID_DISPLAY_NAME",
      "Display name must be text.",
    );
  }
  const displayName = value.trim().replace(/\s+/g, " ");
  if (
    displayName.length < 1 ||
    displayName.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(displayName)
  ) {
    throw new AuthError(
      400,
      "INVALID_DISPLAY_NAME",
      "Display name must contain 1–80 visible characters.",
    );
  }
  return displayName;
}

function parsePhone(value: unknown): string {
  if (typeof value !== "string") {
    throw new AuthError(400, "INVALID_PHONE", "Phone number must be text.");
  }
  const phone = value.trim().replace(/[\s().-]/g, "");
  if (!PHONE_PATTERN.test(phone)) {
    throw new AuthError(
      400,
      "INVALID_PHONE",
      "Use an international phone number such as +963953510300.",
    );
  }
  return phone;
}

function parseRole(value: unknown): UserRole {
  if (
    typeof value !== "string" ||
    !USER_ROLES.includes(value as UserRole)
  ) {
    throw new AuthError(
      400,
      "INVALID_ROLE",
      "Choose administrator, editor, designer, or account manager.",
    );
  }
  return value as UserRole;
}

function parsePassword(value: unknown): string {
  if (typeof value !== "string") {
    throw new AuthError(
      400,
      "INVALID_PASSWORD",
      "An initial password is required.",
    );
  }
  const passwordError = validatePassword(value);
  if (passwordError) {
    throw new AuthError(400, "WEAK_PASSWORD", passwordError);
  }
  return value;
}

function parseActiveState(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new AuthError(
      400,
      "INVALID_ACTIVE_STATE",
      "Active state must be true or false.",
    );
  }
  return value;
}

async function ensureUniqueIdentity(
  database: D1Database,
  username: string,
  phone: string,
  excludingUserId?: number,
) {
  const exclusion =
    excludingUserId === undefined ? "" : " AND id <> ?";
  const bindings =
    excludingUserId === undefined
      ? [username, phone]
      : [username, phone, excludingUserId];
  const conflict = await database
    .prepare(
      `SELECT username,phone
       FROM users
       WHERE (LOWER(username) = ? OR phone = ?)${exclusion}
       LIMIT 1`,
    )
    .bind(...bindings)
    .first<{ username: string; phone: string }>();

  if (!conflict) return;
  if (conflict.username.toLowerCase() === username) {
    throw new AuthError(
      409,
      "USERNAME_EXISTS",
      "That username is already in use.",
    );
  }
  throw new AuthError(
    409,
    "PHONE_EXISTS",
    "That phone number is already in use.",
  );
}

async function assertAnotherActiveAdmin(
  database: D1Database,
  excludingUserId: number,
) {
  const remaining = await database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM users
       WHERE role = 'admin'
         AND is_active = 1
         AND password_hash IS NOT NULL
         AND id <> ?`,
    )
    .bind(excludingUserId)
    .first<CountRow>();
  if (Number(remaining?.count ?? 0) === 0) {
    throw new AuthError(
      409,
      "LAST_ADMIN",
      "Set up another active administrator before removing this access.",
    );
  }
}

function throwIdentityConflict(error: unknown): never {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("users.username") || message.includes("username")) {
    throw new AuthError(
      409,
      "USERNAME_EXISTS",
      "That username is already in use.",
    );
  }
  if (message.includes("users.phone") || message.includes("phone")) {
    throw new AuthError(
      409,
      "PHONE_EXISTS",
      "That phone number is already in use.",
    );
  }
  throw error;
}

function userRouteErrorResponse(error: unknown): Response {
  if (error instanceof SyntaxError) {
    return Response.json(
      { error: "Invalid JSON request.", code: "INVALID_JSON" },
      { status: 400 },
    );
  }
  return authErrorResponse(error);
}

function publicUser(row: UserRow) {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    phone: row.phone,
    role: row.role,
    isActive: Boolean(row.is_active),
    mustChangePassword: Boolean(row.must_change_password),
    tutorialCompleted: Boolean(row.tutorial_completed),
    hasPassword: Boolean(row.password_hash),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

import { sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const USER_ROLES = [
  "admin",
  "editor",
  "designer",
  "account_manager",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TASK_CONTENT_TYPES = ["reel", "post", "draft"] as const;
export const CONTENT_TYPES = [
  "draft",
  "shot_reel",
  "reel",
  "post",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const REPORT_STATUSES = ["draft", "submitted"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const SESSION_STATUSES = [
  "scheduled",
  "completed",
  "cancelled",
  "missed",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    phone: text("phone").notNull(),
    role: text("role", { enum: USER_ROLES }).notNull(),
    passwordHash: text("password_hash"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    mustChangePassword: integer("must_change_password", { mode: "boolean" })
      .notNull()
      .default(false),
    tutorialCompleted: integer("tutorial_completed", { mode: "boolean" })
      .notNull()
      .default(false),
    lastLoginAt: text("last_login_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("users_username_unique").on(table.username),
    uniqueIndex("users_phone_unique").on(table.phone),
    index("users_role_idx").on(table.role),
  ],
);

export const clients = sqliteTable(
  "clients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ozmoClientId: text("ozmo_client_id").unique(),
    name: text("name").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    sessionReelThreshold: integer("session_reel_threshold")
      .notNull()
      .default(4),
    remainingPaymentCents: integer("remaining_payment_cents")
      .notNull()
      .default(0),
    remainingPaymentCurrency: text("remaining_payment_currency")
      .notNull()
      .default("USD"),
    googleDriveUrl: text("google_drive_url"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("clients_name_unique").on(table.name),
    index("clients_active_idx").on(table.isActive),
  ],
);

export const clientLogos = sqliteTable("client_logos", {
  clientId: integer("client_id")
    .primaryKey()
    .references(() => clients.id, { onDelete: "cascade" }),
  png: blob("png", { mode: "buffer" }).notNull(),
  byteSize: integer("byte_size").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const clientMonthlyKpis = sqliteTable(
  "client_monthly_kpis",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    goal: text("goal").notNull(),
    isCompleted: integer("is_completed", { mode: "boolean" })
      .notNull()
      .default(false),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("client_monthly_kpis_client_month_idx").on(
      table.clientId,
      table.month,
    ),
  ],
);

export const reports = sqliteTable(
  "reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reportDate: text("report_date").notNull(),
    status: text("status", { enum: REPORT_STATUSES })
      .notNull()
      .default("draft"),
    summary: text("summary").notNull().default(""),
    submittedAt: text("submitted_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("reports_user_date_unique").on(
      table.userId,
      table.reportDate,
    ),
    index("reports_date_status_idx").on(table.reportDate, table.status),
  ],
);

export const reportCommits = sqliteTable("report_commits", {
  reportId: integer("report_id")
    .primaryKey()
    .references(() => reports.id, { onDelete: "cascade" }),
  committedAt: text("committed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reportId: integer("report_id").references(() => reports.id, {
      onDelete: "set null",
    }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    clientId: integer("client_id").references(() => clients.id, {
      onDelete: "restrict",
    }),
    taskType: text("task_type").notNull(),
    contentType: text("content_type", { enum: TASK_CONTENT_TYPES }),
    action: text("action"),
    quantity: integer("quantity").notNull().default(1),
    isNewContent: integer("is_new_content", { mode: "boolean" }),
    status: text("status").notNull().default("completed"),
    description: text("description").notNull().default(""),
    occurredOn: text("occurred_on").notNull(),
    isCorrection: integer("is_correction", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("tasks_user_date_idx").on(table.userId, table.occurredOn),
    index("tasks_client_date_idx").on(table.clientId, table.occurredOn),
    index("tasks_report_idx").on(table.reportId),
  ],
);

export const inventoryEvents = sqliteTable(
  "inventory_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    contentType: text("content_type", { enum: CONTENT_TYPES }).notNull(),
    delta: integer("delta").notNull(),
    eventType: text("event_type").notNull(),
    taskId: integer("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    actorUserId: integer("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    note: text("note").notNull().default(""),
    occurredOn: text("occurred_on").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("inventory_client_type_idx").on(table.clientId, table.contentType),
    index("inventory_date_idx").on(table.occurredOn),
    index("inventory_task_idx").on(table.taskId),
    uniqueIndex("inventory_session_event_unique")
      .on(table.eventType)
      .where(sql`${table.eventType} LIKE 'session_shot_reels:%'`),
  ],
);

export const inventoryBalances = sqliteTable(
  "inventory_balances",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    contentType: text("content_type", { enum: CONTENT_TYPES }).notNull(),
    quantity: integer("quantity").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("inventory_balances_client_type_unique").on(
      table.clientId,
      table.contentType,
    ),
    check("inventory_balances_nonnegative", sql`${table.quantity} >= 0`),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    scheduledFor: text("scheduled_for").notNull(),
    status: text("status", { enum: SESSION_STATUSES })
      .notNull()
      .default("scheduled"),
    notes: text("notes").notNull().default(""),
    reelsShot: integer("reels_shot"),
    reminderSentAt: text("reminder_sent_at"),
    missedAlertSentAt: text("missed_alert_sent_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("sessions_schedule_status_idx").on(
      table.scheduledFor,
      table.status,
    ),
    index("sessions_client_idx").on(table.clientId),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipientUserId: integer("recipient_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    kind: text("kind").notNull(),
    channel: text("channel").notNull().default("in_app"),
    titleEn: text("title_en").notNull(),
    titleAr: text("title_ar").notNull(),
    messageEn: text("message_en").notNull(),
    messageAr: text("message_ar").notNull(),
    relatedClientId: integer("related_client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    dedupeKey: text("dedupe_key"),
    dueAt: text("due_at"),
    sentAt: text("sent_at"),
    readAt: text("read_at"),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_notifications_recipient_dedupe").on(
      table.recipientUserId,
      table.dedupeKey,
    ),
    index("notifications_dedupe_idx").on(table.dedupeKey),
    index("notifications_recipient_status_idx").on(
      table.recipientUserId,
      table.status,
    ),
    index("notifications_due_idx").on(table.dueAt, table.status),
  ],
);

export const notificationStates = sqliteTable("notification_states", {
  key: text("key").primaryKey(),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  generation: integer("generation").notNull().default(0),
  lastValue: integer("last_value"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    expirationTime: integer("expiration_time"),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    deviceLabel: text("device_label").notNull().default(""),
    platform: text("platform").notNull().default(""),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    failureCount: integer("failure_count").notNull().default(0),
    lastSuccessAt: text("last_success_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
    index("push_subscriptions_user_active_idx").on(
      table.userId,
      table.isActive,
    ),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const userWorkSchedules = sqliteTable(
  "user_work_schedules",
  {
    userId: integer("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    workStart: text("work_start"),
    workEnd: text("work_end"),
    workDays: text("work_days"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("user_work_schedules_updated_idx").on(table.updatedAt)],
);

export const reportCorrections = sqliteTable("report_corrections", {
  reportId: integer("report_id")
    .primaryKey()
    .references(() => reports.id, { onDelete: "cascade" }),
  correctedByUserId: integer("corrected_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  correctedAt: text("corrected_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const activityLogHides = sqliteTable(
  "activity_log_hides",
  {
    sourceType: text("source_type", { enum: ["task", "inventory"] })
      .notNull(),
    sourceId: integer("source_id").notNull(),
    hiddenByUserId: integer("hidden_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    hiddenAt: text("hidden_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    reason: text("reason").notNull().default(""),
  },
  (table) => [
    primaryKey({ columns: [table.sourceType, table.sourceId] }),
    index("activity_log_hides_actor_idx").on(table.hiddenByUserId),
  ],
);

export const sessionDeletions = sqliteTable(
  "session_deletions",
  {
    sessionId: integer("session_id")
      .primaryKey()
      .references(() => sessions.id, { onDelete: "cascade" }),
    deletedByUserId: integer("deleted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    deletedAt: text("deleted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    reason: text("reason").notNull().default(""),
  },
  (table) => [
    index("session_deletions_actor_idx").on(table.deletedByUserId),
  ],
);

export const inventoryPeriods = sqliteTable(
  "inventory_periods",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    label: text("label").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    closedByUserId: integer("closed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    closedAt: text("closed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    uniqueIndex("inventory_periods_label_unique").on(table.label),
    index("inventory_periods_closed_idx").on(table.closedAt),
  ],
);

export const inventoryPeriodSnapshots = sqliteTable(
  "inventory_period_snapshots",
  {
    periodId: integer("period_id")
      .notNull()
      .references(() => inventoryPeriods.id, { onDelete: "restrict" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    contentType: text("content_type", { enum: CONTENT_TYPES }).notNull(),
    closingQuantity: integer("closing_quantity").notNull(),
    carryQuantity: integer("carry_quantity").notNull(),
    resetDelta: integer("reset_delta").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.periodId, table.clientId, table.contentType],
    }),
    index("inventory_period_snapshots_client_idx").on(table.clientId),
    check(
      "inventory_period_snapshots_closing_nonnegative",
      sql`${table.closingQuantity} >= 0`,
    ),
    check(
      "inventory_period_snapshots_carry_valid",
      sql`${table.carryQuantity} >= 0 AND ${table.carryQuantity} <= ${table.closingQuantity}`,
    ),
  ],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const portalUsers = sqliteTable(
  "portal_users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    lastLoginAt: text("last_login_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("portal_users_email_unique").on(table.email),
    index("portal_users_client_active_idx").on(table.clientId, table.isActive),
  ],
);

export const portalAuthSessions = sqliteTable(
  "portal_auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    portalUserId: integer("portal_user_id")
      .notNull()
      .references(() => portalUsers.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("portal_auth_sessions_user_idx").on(table.portalUserId),
    index("portal_auth_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const portalLoginAttempts = sqliteTable(
  "portal_login_attempts",
  {
    key: text("key").primaryKey(),
    attempts: integer("attempts").notNull().default(0),
    windowStartedAt: text("window_started_at").notNull(),
    blockedUntil: text("blocked_until"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("portal_login_attempts_updated_idx").on(table.updatedAt),
  ],
);

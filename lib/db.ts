import { getSQLiteDatabase } from "@/lib/sqlite-d1";

const OZMO_USERS = [
  ["mwafak", "Mwafak", "+963953510300", "admin"],
  ["ghaith", "Ghaith", "+963940402000", "admin"],
  ["yaz", "Yaz", "+963947435201", "admin"],
  ["obay", "Obay", "+963936712876", "editor"],
  ["zeid", "Zeid", "+963930435762", "editor"],
  ["obeid", "Obeid", "+963954787125", "designer"],
  ["abd", "ABD", "+963969630188", "designer"],
  ["jad", "Jad", "+963930281148", "account_manager"],
  ["alaa", "Alaa", "+963950070020", "account_manager"],
] as const;

const OZMO_CLIENTS = [
  ["OZMO-0001", "DKG"],
  ["OZMO-0002", "RAFAAT"],
  ["OZMO-0003", "UNO"],
  ["OZMO-0004", "COLUMBOS"],
  ["OZMO-0005", "FUEGO"],
  ["OZMO-0006", "HANGAR"],
  ["OZMO-0007", "BURGASM"],
  ["OZMO-0008", "WING"],
  ["OZMO-0009", "MAGIC"],
  ["OZMO-0010", "BIGTRUCK"],
  ["OZMO-0011", "KARACA"],
] as const;

const OZMO_SETTINGS = [
  ["company_name", "OZMO"],
  ["timezone", "Asia/Damascus"],
  ["report_deadline", "18:00"],
  ["first_reminder", "17:15"],
  ["second_reminder", "17:25"],
  ["manager_escalation", "18:00"],
  ["working_days", "[6,0,1,2,3]"],
  ["work_start", "10:00"],
  ["work_end", "18:00"],
  ["session_reel_threshold", "4"],
  ["low_reel_threshold", "4"],
  ["low_post_threshold", ""],
  ["low_draft_threshold", ""],
  ["session_reminder_hours", "24"],
  ["upcoming_session_hours", "24"],
  ["session_daily_reminder_time", "11:00"],
  ["missed_session_grace_minutes", "120"],
  ["notification_language", "bilingual"],
  ["office_access", "private_network_only"],
  ["inventory_ready", "false"],
  ["daily_summary_time", "18:05"],
  ["weekly_summary_time", "18:10"],
  ["weekly_summary_day", "3"],
  ["schema_version", "1"],
] as const;

let databaseReady: Promise<void> | null = null;

export function getD1(): D1Database {
  return getSQLiteDatabase();
}

/**
 * Creates the shared database on first use and idempotently seeds the
 * fixed OZMO roster, clients, and operating defaults.
 */
export function ensureDatabase(): Promise<void> {
  if (!databaseReady) {
    databaseReady = initializeDatabase().catch((error) => {
      databaseReady = null;
      throw error;
    });
  }
  return databaseReady;
}

export async function nextOzmoClientId(
  database: D1Database = getD1(),
): Promise<string> {
  const rows = await database
    .prepare(
      `SELECT ozmo_client_id
       FROM clients
       WHERE ozmo_client_id IS NOT NULL`,
    )
    .all<{ ozmo_client_id: string }>();
  const highest = rows.results.reduce((maximum, row) => {
    const match = /^OZMO-(\d{4,})$/.exec(row.ozmo_client_id);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return formatOzmoClientId(highest + 1);
}

async function initializeDatabase(): Promise<void> {
  const database = getD1();

  const schemaSql = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('admin','editor','designer','account_manager')),
      password_hash TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      tutorial_completed INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ozmo_client_id TEXT UNIQUE,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      session_reel_threshold INTEGER NOT NULL DEFAULT 4,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS client_logos (
      client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
      png BLOB NOT NULL,
      byte_size INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      report_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
      summary TEXT NOT NULL DEFAULT '',
      submitted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, report_date)
    )`,
    `CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER REFERENCES reports(id) ON DELETE SET NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      client_id INTEGER REFERENCES clients(id) ON DELETE RESTRICT,
      task_type TEXT NOT NULL,
      content_type TEXT CHECK (content_type IS NULL OR content_type IN ('reel','post','draft')),
      action TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      is_new_content INTEGER,
      status TEXT NOT NULL DEFAULT 'completed',
      description TEXT NOT NULL DEFAULT '',
      occurred_on TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS report_commits (
      report_id INTEGER PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
      committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS inventory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      content_type TEXT NOT NULL CHECK (content_type IN ('draft','shot_reel','reel','post')),
      delta INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      note TEXT NOT NULL DEFAULT '',
      occurred_on TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS inventory_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      content_type TEXT NOT NULL CHECK (content_type IN ('draft','shot_reel','reel','post')),
      quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (client_id,content_type)
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      scheduled_for TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','missed')),
      notes TEXT NOT NULL DEFAULT '',
      reminder_sent_at TEXT,
      missed_alert_sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'in_app',
      title_en TEXT NOT NULL,
      title_ar TEXT NOT NULL,
      message_en TEXT NOT NULL,
      message_ar TEXT NOT NULL,
      related_client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      dedupe_key TEXT,
      due_at TEXT,
      sent_at TEXT,
      read_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS notification_states (
      key TEXT PRIMARY KEY,
      active INTEGER NOT NULL DEFAULT 0,
      generation INTEGER NOT NULL DEFAULT 0,
      last_value INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      expiration_time INTEGER,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      device_label TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_success_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_work_schedules (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      work_start TEXT,
      work_end TEXT,
      work_days TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS report_corrections (
      report_id INTEGER PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
      corrected_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      corrected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS activity_log_hides (
      source_type TEXT NOT NULL CHECK (source_type IN ('task','inventory')),
      source_id INTEGER NOT NULL,
      hidden_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      hidden_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reason TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (source_type,source_id)
    )`,
    `CREATE TABLE IF NOT EXISTS session_deletions (
      session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      deleted_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reason TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS inventory_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL UNIQUE,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      closed_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      closed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notes TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS inventory_period_snapshots (
      period_id INTEGER NOT NULL REFERENCES inventory_periods(id) ON DELETE RESTRICT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      content_type TEXT NOT NULL CHECK (content_type IN ('draft','shot_reel','reel','post')),
      closing_quantity INTEGER NOT NULL CHECK (closing_quantity >= 0),
      carry_quantity INTEGER NOT NULL CHECK (
        carry_quantity >= 0 AND carry_quantity <= closing_quantity
      ),
      reset_delta INTEGER NOT NULL,
      PRIMARY KEY (period_id,client_id,content_type)
    )`,
    `CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS portal_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS portal_auth_sessions (
      token_hash TEXT PRIMARY KEY,
      portal_user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS portal_login_attempts (
      key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      window_started_at TEXT NOT NULL,
      blocked_until TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    "CREATE INDEX IF NOT EXISTS users_role_idx ON users(role)",
    "CREATE INDEX IF NOT EXISTS clients_active_idx ON clients(is_active)",
    "CREATE UNIQUE INDEX IF NOT EXISTS clients_name_nocase_unique ON clients(name COLLATE NOCASE)",
    "CREATE INDEX IF NOT EXISTS reports_date_status_idx ON reports(report_date,status)",
    "CREATE INDEX IF NOT EXISTS tasks_user_date_idx ON tasks(user_id,occurred_on)",
    "CREATE INDEX IF NOT EXISTS tasks_client_date_idx ON tasks(client_id,occurred_on)",
    "CREATE INDEX IF NOT EXISTS tasks_report_idx ON tasks(report_id)",
    "CREATE INDEX IF NOT EXISTS inventory_client_type_idx ON inventory_events(client_id,content_type)",
    "CREATE INDEX IF NOT EXISTS inventory_date_idx ON inventory_events(occurred_on)",
    "CREATE INDEX IF NOT EXISTS inventory_task_idx ON inventory_events(task_id)",
    `CREATE UNIQUE INDEX IF NOT EXISTS inventory_session_event_unique
     ON inventory_events(event_type)
     WHERE event_type LIKE 'session_shot_reels:%'`,
    "CREATE INDEX IF NOT EXISTS sessions_schedule_status_idx ON sessions(scheduled_for,status)",
    "CREATE INDEX IF NOT EXISTS sessions_client_idx ON sessions(client_id)",
    "CREATE INDEX IF NOT EXISTS notifications_recipient_status_idx ON notifications(recipient_user_id,status)",
    "CREATE INDEX IF NOT EXISTS notifications_dedupe_idx ON notifications(dedupe_key)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_recipient_dedupe ON notifications(recipient_user_id,dedupe_key)",
    "CREATE INDEX IF NOT EXISTS notifications_due_idx ON notifications(due_at,status)",
    "CREATE INDEX IF NOT EXISTS push_subscriptions_user_active_idx ON push_subscriptions(user_id,is_active)",
    "CREATE INDEX IF NOT EXISTS user_work_schedules_updated_idx ON user_work_schedules(updated_at)",
    "CREATE INDEX IF NOT EXISTS activity_log_hides_actor_idx ON activity_log_hides(hidden_by_user_id)",
    "CREATE INDEX IF NOT EXISTS session_deletions_actor_idx ON session_deletions(deleted_by_user_id)",
    "CREATE INDEX IF NOT EXISTS inventory_periods_closed_idx ON inventory_periods(closed_at)",
    "CREATE INDEX IF NOT EXISTS inventory_period_snapshots_client_idx ON inventory_period_snapshots(client_id)",
    "CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS portal_users_email_nocase_unique ON portal_users(email COLLATE NOCASE)",
    "CREATE INDEX IF NOT EXISTS portal_users_client_active_idx ON portal_users(client_id,is_active)",
    "CREATE INDEX IF NOT EXISTS portal_auth_sessions_user_idx ON portal_auth_sessions(portal_user_id)",
    "CREATE INDEX IF NOT EXISTS portal_auth_sessions_expiry_idx ON portal_auth_sessions(expires_at)",
    "CREATE INDEX IF NOT EXISTS portal_login_attempts_updated_idx ON portal_login_attempts(updated_at)",
  ];

  await database.batch(
    schemaSql.map((statement) => database.prepare(statement)),
  );

  await ensureColumn(
    database,
    "tasks",
    "is_correction",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await ensureColumn(database, "clients", "ozmo_client_id", "TEXT");
  await ensureColumn(database, "sessions", "reels_shot", "INTEGER");
  await ensureShotReelInventorySupport(database);
  await backfillOzmoClientIds(database);
  await database
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS clients_ozmo_client_id_unique
       ON clients(ozmo_client_id)`,
    )
    .run();

  await database.batch([
    ...OZMO_USERS.map(([username, displayName, phone, role]) =>
      database
        .prepare(
          `INSERT INTO users (username,display_name,phone,role)
           SELECT ?,?,?,?
           WHERE NOT EXISTS (
             SELECT 1 FROM users
             WHERE username=? COLLATE NOCASE OR phone=?
           )`,
        )
        .bind(username, displayName, phone, role, username, phone),
    ),
    ...OZMO_CLIENTS.map(([ozmoClientId, name]) =>
      database
        .prepare(
          `INSERT INTO clients (ozmo_client_id,name)
           SELECT ?,?
           WHERE NOT EXISTS (
             SELECT 1 FROM clients WHERE name=? COLLATE NOCASE
           )`,
        )
        .bind(ozmoClientId, name, name),
    ),
    ...OZMO_SETTINGS.map(([key, value]) =>
      database
        .prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)")
        .bind(key, value),
    ),
    ...(["draft", "shot_reel", "reel", "post"] as const).map((contentType) =>
      database
        .prepare(
          `INSERT OR IGNORE INTO inventory_balances
             (client_id,content_type,quantity)
           SELECT id,?,0 FROM clients`,
        )
        .bind(contentType),
    ),
  ]);

  await database
    .prepare("DELETE FROM auth_sessions WHERE expires_at <= ?")
    .bind(new Date().toISOString())
    .run();
  await database
    .prepare("DELETE FROM portal_auth_sessions WHERE expires_at <= ?")
    .bind(new Date().toISOString())
    .run();
  await database
    .prepare("DELETE FROM portal_login_attempts WHERE updated_at <= ?")
    .bind(new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString())
    .run();
}

async function ensureColumn(
  database: D1Database,
  tableName: "clients" | "tasks" | "sessions",
  columnName: string,
  definition: string,
) {
  const columns = await database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all<{ name: string }>();
  if (columns.results.some((column) => column.name === columnName)) return;
  await database
    .prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
    .run();
}

async function backfillOzmoClientIds(database: D1Database) {
  const rows = await database
    .prepare(
      `SELECT id,name,ozmo_client_id
       FROM clients
       ORDER BY id`,
    )
    .all<{ id: number; name: string; ozmo_client_id: string | null }>();
  const preferredIds = new Map<string, string>(
    OZMO_CLIENTS.map(([ozmoClientId, name]) => [name, ozmoClientId]),
  );
  const usedIds = new Set(
    rows.results
      .map((row) => row.ozmo_client_id)
      .filter((value): value is string => Boolean(value)),
  );
  let nextNumber = rows.results.reduce((maximum, row) => {
    const match = /^OZMO-(\d{4,})$/.exec(row.ozmo_client_id ?? "");
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0) + 1;

  for (const row of rows.results) {
    if (row.ozmo_client_id) continue;
    const preferred = preferredIds.get(row.name.toUpperCase());
    let ozmoClientId = preferred && !usedIds.has(preferred) ? preferred : "";
    while (!ozmoClientId || usedIds.has(ozmoClientId)) {
      ozmoClientId = formatOzmoClientId(nextNumber);
      nextNumber += 1;
    }
    await database
      .prepare("UPDATE clients SET ozmo_client_id=? WHERE id=?")
      .bind(ozmoClientId, row.id)
      .run();
    usedIds.add(ozmoClientId);
  }
}

function formatOzmoClientId(value: number) {
  return `OZMO-${String(value).padStart(4, "0")}`;
}

async function ensureShotReelInventorySupport(database: D1Database) {
  await rebuildInventoryEventsForShotReels(database);
  await rebuildInventoryBalancesForShotReels(database);
  await rebuildInventorySnapshotsForShotReels(database);
  await database.prepare("PRAGMA optimize").run();
}

async function tableSupportsShotReels(
  database: D1Database,
  tableName: string,
) {
  const row = await database
    .prepare(
      `SELECT sql FROM sqlite_schema
       WHERE type='table' AND name=?
       LIMIT 1`,
    )
    .bind(tableName)
    .first<{ sql: string | null }>();
  return row?.sql?.includes("shot_reel") ?? false;
}

async function rebuildInventoryEventsForShotReels(database: D1Database) {
  if (await tableSupportsShotReels(database, "inventory_events")) return;
  await database.batch([
    database.prepare(
      `CREATE TABLE inventory_events_shot_reel_migration (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
        content_type TEXT NOT NULL CHECK (
          content_type IN ('draft','shot_reel','reel','post')
        ),
        delta INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        note TEXT NOT NULL DEFAULT '',
        occurred_on TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    ),
    database.prepare(
      `INSERT INTO inventory_events_shot_reel_migration (
         id,client_id,content_type,delta,event_type,task_id,actor_user_id,
         note,occurred_on,created_at
       )
       SELECT
         id,client_id,content_type,delta,event_type,task_id,actor_user_id,
         note,occurred_on,created_at
       FROM inventory_events`,
    ),
    database.prepare("DROP TABLE inventory_events"),
    database.prepare(
      `ALTER TABLE inventory_events_shot_reel_migration
       RENAME TO inventory_events`,
    ),
    database.prepare(
      `CREATE INDEX inventory_client_type_idx
       ON inventory_events(client_id,content_type)`,
    ),
    database.prepare(
      "CREATE INDEX inventory_date_idx ON inventory_events(occurred_on)",
    ),
    database.prepare(
      "CREATE INDEX inventory_task_idx ON inventory_events(task_id)",
    ),
    database.prepare(
      `CREATE UNIQUE INDEX inventory_session_event_unique
       ON inventory_events(event_type)
       WHERE event_type LIKE 'session_shot_reels:%'`,
    ),
  ]);
}

async function rebuildInventoryBalancesForShotReels(database: D1Database) {
  if (await tableSupportsShotReels(database, "inventory_balances")) return;
  await database.batch([
    database.prepare(
      `CREATE TABLE inventory_balances_shot_reel_migration (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        content_type TEXT NOT NULL CHECK (
          content_type IN ('draft','shot_reel','reel','post')
        ),
        quantity INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (client_id,content_type),
        CONSTRAINT inventory_balances_nonnegative CHECK (quantity >= 0)
      )`,
    ),
    database.prepare(
      `INSERT INTO inventory_balances_shot_reel_migration (
         id,client_id,content_type,quantity,updated_at
       )
       SELECT id,client_id,content_type,quantity,updated_at
       FROM inventory_balances`,
    ),
    database.prepare("DROP TABLE inventory_balances"),
    database.prepare(
      `ALTER TABLE inventory_balances_shot_reel_migration
       RENAME TO inventory_balances`,
    ),
  ]);
}

async function rebuildInventorySnapshotsForShotReels(database: D1Database) {
  if (
    await tableSupportsShotReels(database, "inventory_period_snapshots")
  ) {
    return;
  }
  await database.batch([
    database.prepare(
      `CREATE TABLE inventory_period_snapshots_shot_reel_migration (
        period_id INTEGER NOT NULL
          REFERENCES inventory_periods(id) ON DELETE RESTRICT,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
        content_type TEXT NOT NULL CHECK (
          content_type IN ('draft','shot_reel','reel','post')
        ),
        closing_quantity INTEGER NOT NULL,
        carry_quantity INTEGER NOT NULL,
        reset_delta INTEGER NOT NULL,
        PRIMARY KEY (period_id,client_id,content_type),
        CONSTRAINT inventory_period_snapshots_closing_nonnegative
          CHECK (closing_quantity >= 0),
        CONSTRAINT inventory_period_snapshots_carry_valid
          CHECK (
            carry_quantity >= 0 AND carry_quantity <= closing_quantity
          )
      )`,
    ),
    database.prepare(
      `INSERT INTO inventory_period_snapshots_shot_reel_migration (
         period_id,client_id,content_type,closing_quantity,carry_quantity,
         reset_delta
       )
       SELECT
         period_id,client_id,content_type,closing_quantity,carry_quantity,
         reset_delta
       FROM inventory_period_snapshots`,
    ),
    database.prepare("DROP TABLE inventory_period_snapshots"),
    database.prepare(
      `ALTER TABLE inventory_period_snapshots_shot_reel_migration
       RENAME TO inventory_period_snapshots`,
    ),
    database.prepare(
      `CREATE INDEX inventory_period_snapshots_client_idx
       ON inventory_period_snapshots(client_id)`,
    ),
  ]);
}

import type { DatabaseSync } from "node:sqlite";

/** Rebuild constrained legacy tables atomically, preserving rows, indexes and references. */
export function migrateStoryRoles(database: DatabaseSync) {
  const tables = ["users", "tasks", "inventory_events", "inventory_balances", "inventory_period_snapshots"];
  database.exec("PRAGMA foreign_keys=OFF");
  try {
    database.exec("BEGIN IMMEDIATE");
    for (const table of tables) {
      const row = database.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(table) as { sql: string } | undefined;
      if (!row) continue;
      const updated = table === "users"
        ? row.sql.replace(/'account_manager'(\s*\))/g, "'account_manager','content_creator','content_manager'$1")
        : row.sql.includes("'story'") ? row.sql : row.sql.replace(/'post'/g, "'post','story'");
      if (updated === row.sql) continue;
      const dependent = database.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL").all(table) as { sql: string }[];
      const columns = (database.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(({ name }) => `"${name.replaceAll('"', '""')}"`).join(",");
      const temporary = `${table}_story_role_upgrade`;
      const create = updated.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)/i, `CREATE TABLE "${temporary}"`);
      database.exec(create);
      database.exec(`INSERT INTO "${temporary}" (${columns}) SELECT ${columns} FROM "${table}"`);
      database.exec(`DROP TABLE "${table}"`);
      database.exec(`ALTER TABLE "${temporary}" RENAME TO "${table}"`);
      for (const item of dependent) database.exec(item.sql);
    }
    if (database.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Story/role migration failed foreign-key verification.");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys=ON");
  }
}

import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

type BoundValue = null | number | string | Uint8Array;

let database: SQLiteD1Database | null = null;

export function getSQLiteDatabase(): D1Database {
  if (!database) {
    const configuredPath = process.env.OZMO_DATABASE_PATH?.trim();
    const databasePath = configuredPath || "data/ozmo.sqlite";
    const absolutePath = isAbsolute(databasePath)
      ? databasePath
      : resolve(/* turbopackIgnore: true */ process.cwd(), databasePath);

    mkdirSync(dirname(absolutePath), { recursive: true });
    database = new SQLiteD1Database(absolutePath);
  }

  return database;
}

class SQLiteD1Database implements D1Database {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA busy_timeout = 5000");
  }

  prepare(query: string): D1PreparedStatement {
    return new SQLiteD1PreparedStatement(this.database, query);
  }

  async batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        if (!(statement instanceof SQLiteD1PreparedStatement)) {
          throw new TypeError("Unsupported prepared statement implementation.");
        }
        return statement.execute<T>();
      });
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

class SQLiteD1PreparedStatement implements D1PreparedStatement {
  private readonly parameters: BoundValue[];

  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
    parameters: BoundValue[] = [],
  ) {
    this.parameters = parameters;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new SQLiteD1PreparedStatement(
      this.database,
      this.query,
      values.map(normalizeBoundValue),
    );
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const statement = this.createStatement();
    const row = statement.get(...this.parameters);
    return (row as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const startedAt = performance.now();
    const statement = this.createStatement();
    const rows = statement.all(...this.parameters) as T[];
    return result(rows, 0, undefined, startedAt);
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const startedAt = performance.now();
    const statement = this.createStatement();
    const runResult = statement.run(...this.parameters);
    return result(
      [],
      Number(runResult.changes),
      Number(runResult.lastInsertRowid),
      startedAt,
    );
  }

  execute<T = Record<string, unknown>>(): D1Result<T> {
    const startedAt = performance.now();
    const statement = this.createStatement();
    if (isReaderStatement(this.query)) {
      return result(
        statement.all(...this.parameters) as T[],
        0,
        undefined,
        startedAt,
      );
    }

    const runResult = statement.run(...this.parameters);
    return result(
      [],
      Number(runResult.changes),
      Number(runResult.lastInsertRowid),
      startedAt,
    );
  }

  private createStatement(): StatementSync {
    return this.database.prepare(this.query);
  }
}

function normalizeBoundValue(value: unknown): BoundValue {
  if (value === undefined) return null;
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "string" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return Number(value);
  throw new TypeError(`Unsupported SQLite parameter type: ${typeof value}`);
}

function isReaderStatement(query: string): boolean {
  return /^(?:SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(query.trimStart());
}

function result<T>(
  rows: T[],
  changes: number,
  lastRowId: number | undefined,
  startedAt: number,
): D1Result<T> {
  return {
    results: rows,
    success: true,
    meta: {
      changes,
      ...(lastRowId === undefined ? {} : { last_row_id: lastRowId }),
      duration: performance.now() - startedAt,
    },
  };
}

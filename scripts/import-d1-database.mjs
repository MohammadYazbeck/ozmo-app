import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { backup, DatabaseSync } from "node:sqlite";

function absolutePath(input) {
  return isAbsolute(input) ? input : resolve(process.cwd(), input);
}

function inspectDatabase(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get();
    if (integrity?.integrity_check !== "ok") {
      throw new Error(`SQLite integrity check failed: ${JSON.stringify(integrity)}`);
    }

    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    const counts = Object.fromEntries(
      tables.map(({ name }) => {
        const escapedName = String(name).replaceAll('"', '""');
        const row = database
          .prepare(`SELECT COUNT(*) AS count FROM "${escapedName}"`)
          .get();
        return [name, Number(row?.count ?? 0)];
      }),
    );

    if (!("clients" in counts)) {
      throw new Error("This does not look like an OZMO database: clients table is missing.");
    }

    return { integrity: "ok", counts };
  } finally {
    database.close();
  }
}

const [command, sourceArgument, destinationFlag, destinationArgument] =
  process.argv.slice(2);

if (!sourceArgument || !["--inspect", "--import"].includes(command)) {
  console.error(
    "Usage:\n" +
      "  npm run db:import:d1 -- --inspect <source.sqlite>\n" +
      "  npm run db:import:d1 -- --import <source.sqlite> --to <destination.sqlite>",
  );
  process.exitCode = 1;
} else {
  const source = absolutePath(sourceArgument);
  if (!existsSync(source)) throw new Error(`Source database not found: ${source}`);

  const sourceSummary = inspectDatabase(source);
  if (command === "--inspect") {
    console.log(JSON.stringify({ source, ...sourceSummary }, null, 2));
  } else {
    if (destinationFlag !== "--to" || !destinationArgument) {
      throw new Error("Import requires --to <destination.sqlite>.");
    }

    const destination = absolutePath(destinationArgument);
    if (source === destination) throw new Error("Source and destination must be different.");
    if (existsSync(destination)) {
      throw new Error(
        `Destination already exists; refusing to overwrite it: ${destination}`,
      );
    }

    await mkdir(dirname(destination), { recursive: true });
    const sourceDatabase = new DatabaseSync(source, { readOnly: true });
    try {
      await backup(sourceDatabase, destination);
    } finally {
      sourceDatabase.close();
    }

    const destinationSummary = inspectDatabase(destination);
    console.log(
      JSON.stringify(
        { source, destination, sourceSummary, destinationSummary },
        null,
        2,
      ),
    );
  }
}

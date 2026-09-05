import { mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { backup, DatabaseSync } from "node:sqlite";

const configuredPath = process.env.OZMO_DATABASE_PATH?.trim();
const sourcePath = configuredPath || "data/ozmo.sqlite";
const absoluteSource = isAbsolute(sourcePath)
  ? sourcePath
  : resolve(process.cwd(), sourcePath);
const backupDirectory = resolve(
  process.env.OZMO_BACKUP_DIRECTORY?.trim() || dirname(absoluteSource),
  "backups",
);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = resolve(
  backupDirectory,
  `${basename(absoluteSource, ".sqlite")}-${timestamp}.sqlite`,
);

await mkdir(backupDirectory, { recursive: true });
const database = new DatabaseSync(absoluteSource, { readOnly: true });
try {
  await backup(database, destination);
  console.log(`OZMO database backup created: ${destination}`);
} finally {
  database.close();
}

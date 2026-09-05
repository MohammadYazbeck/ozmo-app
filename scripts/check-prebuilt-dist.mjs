import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const serverRoot = path.join(projectRoot, "dist", "server");
const clientRoot = path.join(projectRoot, "dist", "client");

const requiredFiles = [
  path.join(serverRoot, "wrangler.json"),
  path.join(serverRoot, "index.js"),
  path.join(serverRoot, "__vite_rsc_assets_manifest.js"),
  path.join(serverRoot, "ssr", "index.js"),
  path.join(serverRoot, "ssr", "__vite_rsc_assets_manifest.js"),
  path.join(serverRoot, ".vite", "manifest.json"),
  path.join(clientRoot, ".vite", "manifest.json"),
  path.join(clientRoot, "sw.js"),
  path.join(clientRoot, "manifest.webmanifest"),
];

async function requireNonEmptyFile(filePath) {
  await access(filePath);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size === 0) {
    throw new Error(`${path.relative(projectRoot, filePath)} is empty`);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function validateManifestFiles(manifestPath, outputRoot) {
  const manifest = await readJson(manifestPath);
  const referencedFiles = new Set();

  for (const entry of Object.values(manifest)) {
    if (typeof entry?.file === "string") {
      referencedFiles.add(entry.file);
    }
    for (const collectionName of ["css", "assets"]) {
      if (Array.isArray(entry?.[collectionName])) {
        for (const fileName of entry[collectionName]) {
          if (typeof fileName === "string") {
            referencedFiles.add(fileName);
          }
        }
      }
    }
  }

  for (const relativePath of referencedFiles) {
    const resolvedPath = path.resolve(outputRoot, relativePath);
    if (
      resolvedPath !== outputRoot &&
      !resolvedPath.startsWith(`${outputRoot}${path.sep}`)
    ) {
      throw new Error(`Build manifest contains an unsafe path: ${relativePath}`);
    }
    await requireNonEmptyFile(resolvedPath);
  }
}

try {
  for (const filePath of requiredFiles) {
    await requireNonEmptyFile(filePath);
  }

  const wranglerConfig = await readJson(path.join(serverRoot, "wrangler.json"));
  if (
    wranglerConfig.main !== "index.js" ||
    wranglerConfig.assets?.directory !== "../client"
  ) {
    throw new Error("dist/server/wrangler.json is incomplete");
  }

  await validateManifestFiles(
    path.join(serverRoot, ".vite", "manifest.json"),
    serverRoot,
  );
  await validateManifestFiles(
    path.join(clientRoot, ".vite", "manifest.json"),
    clientRoot,
  );

  console.log("OZMO prebuilt application is ready.");
} catch (error) {
  console.error(
    `OZMO prebuilt application check failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}

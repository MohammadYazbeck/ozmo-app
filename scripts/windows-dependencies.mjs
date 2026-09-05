import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const mode = process.argv[2] ?? "check";
const projectRoot = path.resolve(import.meta.dirname, "..");
const nodeModulesRoot = path.join(projectRoot, "node_modules");
const stampPath = path.join(nodeModulesRoot, ".ozmo-windows-install.json");
const requiredFiles = [
  path.join(nodeModulesRoot, ".bin", "wrangler.cmd"),
  path.join(nodeModulesRoot, ".pnpm", "lock.yaml"),
];

async function fingerprint() {
  const hash = createHash("sha256");
  for (const fileName of ["package.json", "pnpm-lock.yaml"]) {
    hash.update(fileName);
    hash.update(await readFile(path.join(projectRoot, fileName)));
  }
  return hash.digest("hex");
}

async function currentStamp() {
  return {
    fingerprint: await fingerprint(),
    nodeMajor: Number(process.versions.node.split(".")[0]),
    platform: process.platform,
    architecture: process.arch,
  };
}

async function checkDependencies() {
  for (const filePath of requiredFiles) {
    await access(filePath);
  }

  const expected = await currentStamp();
  const saved = JSON.parse(await readFile(stampPath, "utf8"));
  for (const key of Object.keys(expected)) {
    if (saved[key] !== expected[key]) {
      throw new Error(`dependency stamp does not match: ${key}`);
    }
  }
}

try {
  if (mode === "stamp") {
    await mkdir(nodeModulesRoot, { recursive: true });
    await writeFile(
      stampPath,
      `${JSON.stringify(await currentStamp(), null, 2)}\n`,
      "utf8",
    );
    console.log("OZMO Windows dependencies are recorded as complete.");
  } else if (mode === "check") {
    await checkDependencies();
    console.log("OZMO Windows dependencies are ready.");
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
} catch (error) {
  console.error(
    `OZMO Windows dependency check failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}

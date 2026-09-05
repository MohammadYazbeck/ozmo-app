import { execFileSync } from "node:child_process";
import {
  createPrivateKey,
  createPublicKey,
  X509Certificate,
} from "node:crypto";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { networkInterfaces } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import process from "node:process";

import { resolveOfficeHttpsProfile } from "./office-https-profile.mjs";

const projectRoot = process.cwd();
const profile = resolveOfficeHttpsProfile({ projectRoot });
const {
  caKey,
  caCertificate,
  certificateSerial,
  publicCaCertificate,
  publicAndroidCaCertificate,
} = profile;

const requestedIp = process.env.OZMO_OFFICE_IP?.trim();
const officeIp = requestedIp || findPrivateIpv4();
if (!officeIp || !isPrivateIpv4(officeIp)) {
  console.error(
    "No valid private office IPv4 address was found. Run again with OZMO_OFFICE_IP set to the fixed office address.",
  );
  process.exit(1);
}

const profileSpecificFiles = [
  profile.serverKey,
  profile.serverCertificate,
  profile.certificateRequest,
  profile.opensslConfig,
  profile.details,
];
const existingProfileFiles = profileSpecificFiles.filter(fileIsNonEmpty);
if (existingProfileFiles.length > 0) {
  console.error(
    profile.isDefault
      ? "OZMO HTTPS certificates already exist or are incomplete. Back up the .certs folder before intentionally changing the default certificate."
      : `The HTTPS profile "${profile.name}" already exists or is incomplete. No certificate was replaced.`,
  );
  process.exit(1);
}

const caState = [caKey, caCertificate].map(fileIsNonEmpty);
if (profile.isDefault && caState.some(Boolean) && !caState.every(Boolean)) {
  console.error(
    "The OZMO office authority is incomplete. Restore the matching CA certificate and private key from backup.",
  );
  process.exit(1);
}
if (
  !profile.isDefault &&
  ![caKey, caCertificate, certificateSerial].every(fileIsNonEmpty)
) {
  console.error(
    `The HTTPS profile "${profile.name}" requires the existing OZMO office CA and serial file.`,
  );
  console.error(
    "Restore the original .certs folder from this host. A named profile never creates or replaces the office CA.",
  );
  process.exit(1);
}

const opensslExecutable = findOpenSsl();

mkdirSync(profile.certificateRoot, { recursive: true, mode: 0o700 });
mkdirSync(dirname(publicCaCertificate), { recursive: true });

let generationDirectory = profile.certificateDirectory;
let temporaryProfileDirectory;
if (!profile.isDefault) {
  const profilesDirectory = resolve(profile.certificateRoot, "profiles");
  mkdirSync(profilesDirectory, { recursive: true, mode: 0o700 });
  temporaryProfileDirectory = mkdtempSync(
    resolve(profilesDirectory, `.${profile.name}-`),
  );
  generationDirectory = temporaryProfileDirectory;
} else {
  mkdirSync(generationDirectory, { recursive: true, mode: 0o700 });
}

const serverKey = resolve(generationDirectory, basename(profile.serverKey));
const serverCertificate = resolve(
  generationDirectory,
  basename(profile.serverCertificate),
);
const certificateRequest = resolve(
  generationDirectory,
  basename(profile.certificateRequest),
);
const opensslConfig = resolve(
  generationDirectory,
  basename(profile.opensslConfig),
);
const detailsPath = resolve(generationDirectory, basename(profile.details));

try {
  writeFileSync(
    opensslConfig,
    `[req]
prompt = no
distinguished_name = distinguished_name
req_extensions = request_extensions

[distinguished_name]
CN = OZMO Office
O = OZMO

[request_extensions]
subjectAltName = @alternative_names

[ca_extensions]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always

[server_extensions]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alternative_names

[alternative_names]
DNS.1 = localhost
DNS.2 = ozmo.local
IP.1 = 127.0.0.1
IP.2 = ${officeIp}
`,
    { mode: 0o600 },
  );

  if (!caState.some(Boolean)) {
    if (!profile.isDefault) {
      throw new Error("A named profile cannot create an office authority.");
    }
    runOpenSsl(["genrsa", "-out", caKey, "4096"]);
    runOpenSsl([
      "req",
      "-x509",
      "-new",
      "-sha256",
      "-days",
      "3650",
      "-key",
      caKey,
      "-out",
      caCertificate,
      "-subj",
      "/CN=OZMO Office Local CA/O=OZMO",
      "-extensions",
      "ca_extensions",
      "-config",
      opensslConfig,
    ]);
  }

  runOpenSsl(["genrsa", "-out", serverKey, "2048"]);
  runOpenSsl([
    "req",
    "-new",
    "-key",
    serverKey,
    "-out",
    certificateRequest,
    "-config",
    opensslConfig,
  ]);
  const serialArguments = fileIsNonEmpty(certificateSerial)
    ? ["-CAserial", certificateSerial]
    : ["-CAcreateserial"];
  if (!profile.isDefault && serialArguments.includes("-CAcreateserial")) {
    throw new Error("A named profile cannot create a new CA serial file.");
  }
  runOpenSsl([
    "x509",
    "-req",
    "-in",
    certificateRequest,
    "-CA",
    caCertificate,
    "-CAkey",
    caKey,
    ...serialArguments,
    "-out",
    serverCertificate,
    "-days",
    "825",
    "-sha256",
    "-extensions",
    "server_extensions",
    "-extfile",
    opensslConfig,
  ]);

  const ca = validateGeneratedCertificate({
    officeIp,
    caCertificate,
    serverCertificate,
    serverKey,
  });
  writeFileSync(
    detailsPath,
    `${JSON.stringify(
      {
        officeIp,
        officeUrl: `https://${officeIp}:3000`,
        generatedAt: new Date().toISOString(),
        profile: profile.name,
        certificatePath: relative(projectRoot, profile.serverCertificate),
        keyPath: relative(projectRoot, profile.serverKey),
        caFingerprint: ca.fingerprint256,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  if (process.platform !== "win32") {
    chmodSync(caKey, 0o600);
    chmodSync(serverKey, 0o600);
    chmodSync(caCertificate, 0o644);
    chmodSync(serverCertificate, 0o644);
  }

  if (temporaryProfileDirectory) {
    renameSync(temporaryProfileDirectory, profile.certificateDirectory);
    temporaryProfileDirectory = undefined;
  }

  copyFileSync(caCertificate, publicCaCertificate);
  runOpenSsl([
    "x509",
    "-in",
    caCertificate,
    "-outform",
    "DER",
    "-out",
    publicAndroidCaCertificate,
  ]);
  validatePublicCaCopies({
    caCertificate,
    publicCaCertificate,
    publicAndroidCaCertificate,
  });
  if (process.platform !== "win32") {
    chmodSync(publicCaCertificate, 0o644);
    chmodSync(publicAndroidCaCertificate, 0o644);
  }
} catch (error) {
  if (temporaryProfileDirectory && existsSync(temporaryProfileDirectory)) {
    rmSync(temporaryProfileDirectory, { recursive: true, force: true });
  }
  throw error;
}

console.log("OZMO private HTTPS certificates are ready.");
if (!profile.isDefault) {
  console.log(`Certificate profile: ${profile.name}`);
}
console.log(`Office address: https://${officeIp}:3000`);
console.log(
  "Install public/ozmo-office-ca-android.cer as a CA certificate on Android. Never install or share the private CA key.",
);

function fileIsNonEmpty(path) {
  return existsSync(path) && statSync(path).size > 0;
}

function validateGeneratedCertificate({
  officeIp: savedIp,
  caCertificate: caPath,
  serverCertificate: serverPath,
  serverKey: keyPath,
}) {
  const ca = new X509Certificate(readFileSync(caPath));
  const server = new X509Certificate(readFileSync(serverPath));
  const privateKey = createPrivateKey(readFileSync(keyPath));
  const privateKeyPublicBytes = createPublicKey(privateKey).export({
    format: "der",
    type: "spki",
  });
  const certificatePublicBytes = server.publicKey.export({
    format: "der",
    type: "spki",
  });
  const now = Date.now();

  if (!ca.ca) throw new Error("The office authority is not marked as a CA.");
  if (!server.verify(ca.publicKey)) {
    throw new Error("The server certificate was not signed by the office CA.");
  }
  if (!server.checkIP(savedIp)) {
    throw new Error(`The server certificate does not include ${savedIp}.`);
  }
  if (!privateKeyPublicBytes.equals(certificatePublicBytes)) {
    throw new Error("The server certificate does not match its private key.");
  }
  for (const [label, certificate] of [
    ["office authority", ca],
    ["server certificate", server],
  ]) {
    if (
      now < new Date(certificate.validFrom).getTime() ||
      now > new Date(certificate.validTo).getTime()
    ) {
      throw new Error(`The ${label} is not currently valid.`);
    }
  }
  return ca;
}

function validatePublicCaCopies({
  caCertificate: caPath,
  publicCaCertificate: publicPemPath,
  publicAndroidCaCertificate: publicDerPath,
}) {
  const expected = new X509Certificate(readFileSync(caPath));
  const publicPem = new X509Certificate(readFileSync(publicPemPath));
  const publicDer = new X509Certificate(readFileSync(publicDerPath));
  if (
    publicPem.fingerprint256 !== expected.fingerprint256 ||
    publicDer.fingerprint256 !== expected.fingerprint256
  ) {
    throw new Error("The public certificate downloads do not match the office CA.");
  }
}

function runOpenSsl(args) {
  execFileSync(opensslExecutable, args, { stdio: "inherit" });
}

function findOpenSsl() {
  const configured = process.env.OZMO_OPENSSL_PATH?.trim();
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 =
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const candidates = [
    configured,
    ...(process.platform === "win32"
      ? [
          resolve(programFiles, "Git", "usr", "bin", "openssl.exe"),
          resolve(programFiles, "Git", "mingw64", "bin", "openssl.exe"),
          resolve(programFilesX86, "Git", "usr", "bin", "openssl.exe"),
          resolve(programFiles, "OpenSSL-Win64", "bin", "openssl.exe"),
        ]
      : [
          "/usr/bin/openssl",
          "/opt/homebrew/bin/openssl",
          "/usr/local/bin/openssl",
        ]),
  ].filter(Boolean);
  const directMatch = candidates.find((candidate) => existsSync(candidate));
  if (directMatch) return directMatch;

  try {
    const resolver =
      process.platform === "win32" ? "where.exe" : "/usr/bin/which";
    const resolved = execFileSync(resolver, ["openssl"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (resolved) return resolved;
  } catch {
    // The friendly platform-specific message below explains what is missing.
  }

  throw new Error(
    process.platform === "win32"
      ? "OpenSSL was not found. Install Git for Windows, then run this file again."
      : "OpenSSL was not found. Install OpenSSL, then run this file again.",
  );
}

function findPrivateIpv4() {
  const candidates = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family !== "IPv4" || address.internal) continue;
      if (isPrivateIpv4(address.address)) candidates.push(address.address);
    }
  }
  return (
    candidates.sort((left, right) => {
      return privateAddressPriority(left) - privateAddressPriority(right);
    })[0] || null
  );
}

function privateAddressPriority(address) {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  return 2;
}

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

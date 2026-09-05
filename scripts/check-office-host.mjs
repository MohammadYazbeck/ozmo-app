import {
  createPrivateKey,
  createPublicKey,
  X509Certificate,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { relative } from "node:path";
import process from "node:process";

import { resolveOfficeHttpsProfile } from "./office-https-profile.mjs";

const projectRoot = process.cwd();
const profile = resolveOfficeHttpsProfile({ projectRoot });
const profileCertificateFiles = [
  profile.details,
  profile.serverKey,
  profile.serverCertificate,
];
const sharedCertificateFiles = [
  profile.caCertificate,
  profile.publicCaCertificate,
  profile.publicAndroidCaCertificate,
];
const profileCertificateState = profileCertificateFiles.map((path) =>
  existsSync(path),
);

if (profileCertificateState.every((present) => !present)) {
  console.log(
    profile.isDefault
      ? "OZMO HTTPS certificates have not been created on this host yet."
      : `The OZMO HTTPS profile "${profile.name}" has not been created yet.`,
  );
  process.exit(2);
}
const missingFiles = [...profileCertificateFiles, ...sharedCertificateFiles]
  .filter((path) => !existsSync(path))
  .map((path) => relative(projectRoot, path));
if (missingFiles.length > 0) {
  console.error("The OZMO certificate copy is incomplete.");
  console.error(`Missing: ${missingFiles.join(", ")}`);
  console.error(
    "Restore these files from the same OZMO host backup. No certificate was replaced.",
  );
  process.exit(3);
}

let details;
try {
  details = JSON.parse(readFileSync(profile.details, "utf8"));
} catch {
  console.error("The OZMO HTTPS setup file is unreadable.");
  process.exit(3);
}

const officeIp = String(details.officeIp || "");
const requestedIp = String(process.env.OZMO_OFFICE_IP || "").trim();
const currentPrivateIps = privateIpv4Addresses();
if (details.profile && details.profile !== profile.name) {
  console.error(
    `The selected HTTPS profile is "${profile.name}", but its setup file belongs to "${details.profile}".`,
  );
  process.exit(3);
}
if (!isPrivateIpv4(officeIp)) {
  console.error("The OZMO HTTPS setup does not contain a valid private IP.");
  process.exit(3);
}
if (requestedIp && requestedIp !== officeIp) {
  console.error(
    `The selected HTTPS profile belongs to ${officeIp}, but this launcher requires ${requestedIp}.`,
  );
  process.exit(3);
}
if (!currentPrivateIps.includes(officeIp)) {
  console.error(
    `These certificates belong to ${officeIp}, but this computer currently uses ${
      currentPrivateIps.join(", ") || "no private office address"
    }.`,
  );
  console.error(
    "Give this host the saved IP in the router, or back up the .certs folder and generate certificates for the new fixed IP.",
  );
  process.exit(3);
}

try {
  validateCertificateCopy(officeIp);
} catch (error) {
  console.error(
    `The OZMO certificate copy failed its safety check: ${
      error instanceof Error ? error.message : "unknown certificate error"
    }`,
  );
  console.error(
    "Restore the certificate files from the same OZMO host backup. No certificate was replaced.",
  );
  process.exit(3);
}

if (!profile.isDefault) {
  console.log(`Certificate profile: ${profile.name}`);
}
console.log(`Secure app:  https://${officeIp}:3000`);
console.log(`Phone setup: http://${officeIp}:3001`);

function validateCertificateCopy(savedIp) {
  const caCertificate = new X509Certificate(
    readFileSync(profile.caCertificate),
  );
  const serverCertificate = new X509Certificate(
    readFileSync(profile.serverCertificate),
  );
  const publicPemCertificate = new X509Certificate(
    readFileSync(profile.publicCaCertificate),
  );
  const publicDerCertificate = new X509Certificate(
    readFileSync(profile.publicAndroidCaCertificate),
  );
  const serverPrivateKey = createPrivateKey(readFileSync(profile.serverKey));
  const privateKeyPublicBytes = createPublicKey(serverPrivateKey).export({
    format: "der",
    type: "spki",
  });
  const certificatePublicBytes = serverCertificate.publicKey.export({
    format: "der",
    type: "spki",
  });
  const now = Date.now();

  if (!caCertificate.ca) {
    throw new Error("the office authority is not marked as a CA");
  }
  if (!serverCertificate.verify(caCertificate.publicKey)) {
    throw new Error("the server certificate was not signed by this office CA");
  }
  if (!serverCertificate.checkIP(savedIp)) {
    throw new Error(`the server certificate does not include ${savedIp}`);
  }
  if (!privateKeyPublicBytes.equals(certificatePublicBytes)) {
    throw new Error("the server certificate does not match its private key");
  }
  for (const [label, certificate] of [
    ["office authority", caCertificate],
    ["server certificate", serverCertificate],
  ]) {
    if (
      now < new Date(certificate.validFrom).getTime() ||
      now > new Date(certificate.validTo).getTime()
    ) {
      throw new Error(`${label} is not currently valid`);
    }
  }
  if (
    publicPemCertificate.fingerprint256 !== caCertificate.fingerprint256 ||
    publicDerCertificate.fingerprint256 !== caCertificate.fingerprint256
  ) {
    throw new Error("the public downloads do not match the current office CA");
  }
}

function privateIpv4Addresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (
        entry.family === "IPv4" &&
        !entry.internal &&
        isPrivateIpv4(entry.address)
      ) {
        addresses.push(entry.address);
      }
    }
  }
  return [...new Set(addresses)];
}

function isPrivateIpv4(value) {
  const parts = value.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some(
      (part) => !Number.isInteger(part) || part < 0 || part > 255,
    )
  ) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

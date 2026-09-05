import { resolve } from "node:path";
import process from "node:process";

const DEFAULT_PROFILE = "default";
const PROFILE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,62})$/;

export function resolveOfficeHttpsProfile({
  projectRoot = process.cwd(),
  environment = process.env,
} = {}) {
  const requestedName = String(
    environment.OZMO_HTTPS_PROFILE || DEFAULT_PROFILE,
  ).trim();
  const name = requestedName || DEFAULT_PROFILE;
  if (name !== DEFAULT_PROFILE && !PROFILE_NAME_PATTERN.test(name)) {
    throw new Error(
      "OZMO_HTTPS_PROFILE must contain only lowercase letters, numbers, dots, or hyphens.",
    );
  }

  const certificateRoot = resolve(projectRoot, ".certs");
  const isDefault = name === DEFAULT_PROFILE;
  const certificateDirectory = isDefault
    ? certificateRoot
    : resolve(certificateRoot, "profiles", name);

  return {
    name,
    isDefault,
    certificateRoot,
    certificateDirectory,
    caKey: resolve(certificateRoot, "ozmo-office-ca-key.pem"),
    caCertificate: resolve(certificateRoot, "ozmo-office-ca.pem"),
    certificateSerial: resolve(certificateRoot, "ozmo-office-ca.srl"),
    serverKey: resolve(
      certificateDirectory,
      isDefault ? "ozmo-office-key.pem" : "server-key.pem",
    ),
    serverCertificate: resolve(
      certificateDirectory,
      isDefault ? "ozmo-office.pem" : "server.pem",
    ),
    certificateRequest: resolve(
      certificateDirectory,
      isDefault ? "ozmo-office.csr" : "server.csr",
    ),
    opensslConfig: resolve(
      certificateDirectory,
      isDefault ? "ozmo-office.cnf" : "server.cnf",
    ),
    details: resolve(certificateDirectory, "office-https.json"),
    publicCaCertificate: resolve(
      projectRoot,
      "public/ozmo-office-ca.crt",
    ),
    publicAndroidCaCertificate: resolve(
      projectRoot,
      "public/ozmo-office-ca-android.cer",
    ),
  };
}

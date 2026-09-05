import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import https from "node:https";

import { resolveOfficeHttpsProfile } from "./office-https-profile.mjs";

const profile = resolveOfficeHttpsProfile();
const expectedFingerprint = existsSync(profile.serverCertificate)
  ? new X509Certificate(
      readFileSync(profile.serverCertificate),
    ).fingerprint256
  : "";

try {
  const response = await requestSetupStatus();
  const details = JSON.parse(response.body);
  if (
    response.statusCode >= 200 &&
    response.statusCode < 300 &&
    details.company === "OZMO" &&
    response.certificateFingerprint === expectedFingerprint
  ) {
    process.exit(0);
  }
} catch {
  // A silent non-zero exit lets the friendly launcher explain the port conflict.
}

process.exit(1);

function requestSetupStatus() {
  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path: "/api/setup/status",
        rejectUnauthorized: false,
        timeout: 3_000,
      },
      (response) => {
        let body = "";
        const peerCertificate = response.socket.getPeerCertificate();
        const certificateFingerprint = peerCertificate.raw
          ? new X509Certificate(peerCertificate.raw).fingerprint256
          : "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 32_768) request.destroy();
        });
        response.on("end", () => {
          resolve({
            body,
            statusCode: response.statusCode || 0,
            certificateFingerprint,
          });
        });
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", reject);
  });
}

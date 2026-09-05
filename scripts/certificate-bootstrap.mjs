import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import process from "node:process";

import { resolveOfficeHttpsProfile } from "./office-https-profile.mjs";

const projectRoot = process.cwd();
const profile = resolveOfficeHttpsProfile({ projectRoot });
const officeDetails = JSON.parse(
  readFileSync(profile.details, "utf8"),
);
const officeIp = String(officeDetails.officeIp || "");
if (!isPrivateIpv4(officeIp)) {
  throw new Error("The OZMO office setup file does not contain a private IPv4 address.");
}

const port = Number(process.env.OZMO_SETUP_PORT || 3001);
if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
  throw new Error("OZMO_SETUP_PORT must be a valid non-privileged port.");
}

const caPem = readFileSync(
  profile.caCertificate,
  "utf8",
);
const certificate = new X509Certificate(caPem);
const androidCertificate = readFileSync(
  profile.publicAndroidCaCertificate,
);
const desktopCertificate = Buffer.from(caPem, "utf8");
const appleProfile = Buffer.from(
  buildAppleProfile(certificate.raw, certificate.fingerprint256),
  "utf8",
);
const setupUrl = `http://${officeIp}:${port}`;
const appUrl = `https://${officeIp}:3000`;
const page = Buffer.from(
  buildSetupPage({
    appUrl,
    fingerprint: certificate.fingerprint256,
  }),
  "utf8",
);

if (process.argv.includes("--print-apple-profile")) {
  process.stdout.write(appleProfile);
  process.exit(0);
}

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", setupUrl);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return send(response, 405, "text/plain; charset=utf-8", Buffer.from("Method not allowed."));
  }

  if (requestUrl.pathname === "/health") {
    return send(
      response,
      200,
      "application/json; charset=utf-8",
      Buffer.from(
        JSON.stringify({
          ok: true,
          service: "OZMO device setup",
          appUrl,
        }),
      ),
      request.method === "HEAD",
    );
  }
  if (requestUrl.pathname === "/ozmo-office-ca-android.cer") {
    return send(
      response,
      200,
      "application/pkix-cert",
      androidCertificate,
      request.method === "HEAD",
      'attachment; filename="ozmo-office-ca-android.cer"',
    );
  }
  if (requestUrl.pathname === "/ozmo-office-ca-windows.cer") {
    return send(
      response,
      200,
      "application/pkix-cert",
      androidCertificate,
      request.method === "HEAD",
      'attachment; filename="OZMO-Office-CA-Windows.cer"',
    );
  }
  if (requestUrl.pathname === "/ozmo-office-ca-macos.crt") {
    return send(
      response,
      200,
      "application/x-x509-ca-cert",
      desktopCertificate,
      request.method === "HEAD",
      'attachment; filename="OZMO-Office-CA-macOS.crt"',
    );
  }
  if (requestUrl.pathname === "/ozmo-office-ca-apple.mobileconfig") {
    return send(
      response,
      200,
      "application/x-apple-aspen-config",
      appleProfile,
      request.method === "HEAD",
      'attachment; filename="OZMO-Office-Access.mobileconfig"',
    );
  }
  if (requestUrl.pathname === "/fingerprint.txt") {
    return send(
      response,
      200,
      "text/plain; charset=utf-8",
      Buffer.from(`${certificate.fingerprint256}\n`),
      request.method === "HEAD",
      'attachment; filename="OZMO-CA-SHA256.txt"',
    );
  }
  if (requestUrl.pathname === "/") {
    return send(
      response,
      200,
      "text/html; charset=utf-8",
      page,
      request.method === "HEAD",
    );
  }

  return send(response, 404, "text/plain; charset=utf-8", Buffer.from("Not found."));
});

server.on("error", (error) => {
  console.error(`OZMO device setup could not start: ${error.message}`);
  process.exit(1);
});
server.listen(port, officeIp, () => {
  console.log(`OZMO phone and tablet setup: ${setupUrl}`);
  console.log(`OZMO secure application: ${appUrl}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function send(
  response,
  status,
  contentType,
  body,
  headOnly = false,
  disposition,
) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": String(body.length),
    "Content-Type": contentType,
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...(disposition ? { "Content-Disposition": disposition } : {}),
  });
  response.end(headOnly ? undefined : body);
}

function buildAppleProfile(certificateDer, fingerprint) {
  const certificateData = certificateDer
    .toString("base64")
    .match(/.{1,68}/g)
    .map((line) => `        ${line}`)
    .join("\n");
  const identifierSuffix = fingerprint
    .replaceAll(":", "")
    .slice(-12)
    .toLowerCase();
  const certificatePayloadUuid = stableProfileUuid(
    fingerprint,
    "certificate",
  );
  const profilePayloadUuid = stableProfileUuid(fingerprint, "profile");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key>
      <string>OZMO Office CA.cer</string>
      <key>PayloadContent</key>
      <data>
${certificateData}
      </data>
      <key>PayloadDescription</key>
      <string>Allows this managed device to trust the private OZMO office website.</string>
      <key>PayloadDisplayName</key>
      <string>OZMO Office CA</string>
      <key>PayloadIdentifier</key>
      <string>com.ozmo.office.ca.${identifierSuffix}</string>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadUUID</key>
      <string>${certificatePayloadUuid}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Installs the public OZMO office certificate. It contains no private key.</string>
  <key>PayloadDisplayName</key>
  <string>OZMO Office Access</string>
  <key>PayloadIdentifier</key>
  <string>com.ozmo.office.profile.${identifierSuffix}</string>
  <key>PayloadOrganization</key>
  <string>OZMO</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${profilePayloadUuid}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
}

function stableProfileUuid(fingerprint, purpose) {
  const value = createHash("sha256")
    .update(`${fingerprint}:${purpose}`)
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join("-");
}

function buildSetupPage({ appUrl, fingerprint }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#ff5a0a">
  <title>OZMO · Device Setup</title>
  <style>
    :root{color-scheme:light;--orange:#ff5a0a;--ink:#172019;--muted:#667169;--line:#e3e8e4;--soft:#f5f8f5}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 90% 0,#fff0e5,transparent 28rem),#f2f5f2;color:var(--ink);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
    main{width:min(920px,calc(100% - 28px));margin:0 auto;padding:34px 0 50px}.hero,.card,.network{background:#fff;border:1px solid var(--line);box-shadow:0 18px 50px rgba(25,39,29,.08)}
    .hero{padding:clamp(24px,5vw,48px);border-radius:26px}.brand{display:flex;align-items:center;gap:12px;font-size:18px;font-weight:900;letter-spacing:.14em}.mark{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:var(--orange);color:#fff;font-size:22px}
    h1{max-width:680px;margin:30px 0 10px;font-size:clamp(31px,6vw,54px);line-height:1.02;letter-spacing:-.055em}p{margin:0;color:var(--muted);line-height:1.65}.ok{display:inline-flex;align-items:center;gap:7px;margin-top:22px;padding:8px 11px;border-radius:999px;background:#e8f7ef;color:#11794e;font-size:12px;font-weight:800}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:14px}.card{padding:23px;border-radius:20px}.card h2{margin:0 0 8px;font-size:20px}.ar{display:block;margin-top:3px;color:#7b837d;font-size:12px;direction:rtl}.steps{display:grid;gap:9px;margin:18px 0;padding:0;counter-reset:step}.steps li{display:flex;gap:9px;color:#48534b;font-size:13px;line-height:1.45;list-style:none}.steps li:before{counter-increment:step;content:counter(step);display:grid;place-items:center;width:22px;height:22px;flex:0 0 22px;border-radius:7px;background:#fff0e7;color:#c64400;font-weight:900}
    .button{display:flex;align-items:center;justify-content:center;min-height:46px;padding:11px 15px;border-radius:12px;background:var(--orange);color:#fff;text-decoration:none;font-size:13px;font-weight:850}.button.secondary{background:#eff3f0;color:var(--ink)}
    .card-actions{display:grid;gap:8px}
    .network{display:grid;gap:12px;margin-top:14px;padding:22px;border-radius:20px}.network strong{font-size:14px}.links{display:flex;gap:9px;flex-wrap:wrap}.links .button{flex:1 1 220px}.fingerprint{overflow-wrap:anywhere;padding:10px 12px;border-radius:10px;background:#f4f6f4;color:#677269;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px}
    .warning{margin-top:14px;padding:15px 17px;border:1px solid #f0dfbd;border-radius:14px;background:#fff8e8;color:#76541f;font-size:12px;line-height:1.55}
    @media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:680px){main{padding-top:14px}.hero{border-radius:20px}.grid{grid-template-columns:1fr}.card,.network{border-radius:16px}}
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="brand"><span class="mark">O</span> OZMO</div>
      <h1>Connect this phone or tablet to the private office app.</h1>
      <p>This setup page contains only OZMO’s public trust certificate and instructions. No passwords, staff reports, private keys, or company data are available here.</p>
      <span class="ok">✓ This device can reach the OZMO host</span>
    </section>

    <div class="grid">
      <section class="card">
        <h2>iPhone or iPad <span class="ar">إعداد آيفون أو آيباد</span></h2>
        <ol class="steps">
          <li>Download the Apple profile below, then open Settings → Profile Downloaded → Install.</li>
          <li>Open Settings → General → About → Certificate Trust Settings and enable full trust for OZMO Office CA.</li>
          <li>Open the secure OZMO link in Safari, then Share → Add to Home Screen.</li>
          <li>Launch OZMO from its Home Screen icon and enable notifications.</li>
        </ol>
        <a class="button" href="/ozmo-office-ca-apple.mobileconfig">Download Apple profile</a>
      </section>

      <section class="card">
        <h2>Android phones <span class="ar">إعداد أجهزة أندرويد</span></h2>
        <ol class="steps">
          <li>Download the Android CA certificate below.</li>
          <li>In Settings, search for “CA certificate” or “Install certificate”.</li>
          <li>Choose CA certificate. Do not choose VPN/app or Wi-Fi certificate. Confirm with the phone PIN.</li>
          <li>Open the secure OZMO link in updated Chrome or Samsung Internet and enable notifications.</li>
        </ol>
        <a class="button" href="/ozmo-office-ca-android.cer">Download Android CA</a>
      </section>

      <section class="card">
        <h2>Windows or Mac <span class="ar">إعداد الكمبيوتر</span></h2>
        <ol class="steps">
          <li>Windows: download the Windows certificate, open it, and choose Install Certificate.</li>
          <li>Select Current User, then place it in Trusted Root Certification Authorities—not Personal.</li>
          <li>Mac: download the macOS certificate, add it in Keychain Access, open it, and set Trust to Always Trust.</li>
          <li>Fully close every Chrome or Edge window, reopen the exact secure OZMO address, and confirm there is no warning.</li>
        </ol>
        <div class="card-actions">
          <a class="button" href="/ozmo-office-ca-windows.cer">Windows certificate</a>
          <a class="button secondary" href="/ozmo-office-ca-macos.crt">macOS certificate</a>
        </div>
      </section>
    </div>

    <section class="network">
      <strong>After the certificate is installed and trusted</strong>
      <div class="links">
        <a class="button" href="${appUrl}">Open secure OZMO</a>
        <a class="button secondary" href="/fingerprint.txt">Download certificate fingerprint</a>
      </div>
      <p>Use the normal office Wi-Fi—not Guest Wi-Fi. Turn off VPN, Samsung Secure Wi-Fi, and mobile-data switching while testing. The device Wi-Fi address should begin with 192.168.1.</p>
      <div class="fingerprint">OZMO CA SHA-256 · ${fingerprint}</div>
    </section>

    <div class="warning">
      If an OZMO certificate was installed earlier but the browser still reports an SSL error, remove the older OZMO Office certificate or profile and install the current download again. Never continue through a certificate warning. Huawei phones without Google Play Services may open and use OZMO, but standard browser push may be unavailable.
    </div>
  </main>
</body>
</html>`;
}

function isPrivateIpv4(value) {
  const parts = value.split(".").map(Number);
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

import { networkInterfaces } from "node:os";
import process from "node:process";

const expectedIp = String(process.argv[2] || "").trim();
if (!isPrivateIpv4(expectedIp)) {
  console.error("The required Windows host IP is invalid.");
  process.exit(1);
}

const currentIps = [];
for (const entries of Object.values(networkInterfaces())) {
  for (const entry of entries || []) {
    if (
      entry.family === "IPv4" &&
      !entry.internal &&
      isPrivateIpv4(entry.address)
    ) {
      currentIps.push(entry.address);
    }
  }
}

if (!currentIps.includes(expectedIp)) {
  console.error(
    `This Windows launcher requires ${expectedIp}, but this computer currently uses ${
      [...new Set(currentIps)].join(", ") || "no private office address"
    }.`,
  );
  console.error(
    "Reserve the required address for this laptop in the router, reconnect Wi-Fi, and try again.",
  );
  process.exit(1);
}

console.log(`Windows host IP confirmed: ${expectedIp}`);

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

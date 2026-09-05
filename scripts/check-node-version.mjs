import process from "node:process";

const minimum = [22, 13, 0];
const current = process.versions.node.split(".").map(Number);
const supported = compareVersions(current, minimum) >= 0;

if (!supported) {
  console.error(
    `OZMO needs Node.js 22.13.0 or newer. This computer has Node.js ${process.versions.node}.`,
  );
  process.exit(1);
}

function compareVersions(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

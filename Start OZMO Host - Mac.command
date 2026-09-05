#!/bin/zsh

PROJECT_DIRECTORY="${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH}"
cd "${PROJECT_DIRECTORY}" || exit 1

LAUNCH_AGENT="${HOME}/Library/LaunchAgents/com.ozmo.office.plist"
SERVICE_NODE=""
SERVICE_PNPM_SCRIPT=""
if [[ -f "${LAUNCH_AGENT}" ]]; then
  SERVICE_NODE="$(/usr/libexec/PlistBuddy -c "Print :ProgramArguments:2" "${LAUNCH_AGENT}" 2>/dev/null || true)"
  SERVICE_PNPM_SCRIPT="$(/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:OZMO_PACKAGE_MANAGER_SCRIPT" "${LAUNCH_AGENT}" 2>/dev/null || true)"
  if [[ -x "${SERVICE_NODE}" ]]; then
    export PATH="${SERVICE_NODE:h}:${PATH}"
  fi
fi

finish() {
  local result="${1:-1}"
  echo
  echo "Press any key to close this window."
  read -k 1
  exit "${result}"
}

run_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    command pnpm "$@"
  elif [[ -n "${SERVICE_PNPM_SCRIPT}" && -f "${SERVICE_PNPM_SCRIPT}" ]]; then
    OZMO_PACKAGE_MANAGER_SCRIPT="${SERVICE_PNPM_SCRIPT}" \
      node "${SERVICE_PNPM_SCRIPT}" "$@"
  else
    return 127
  fi
}

clear
echo "OZMO · Mac host"
echo "================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is missing. Install Node.js 22.13.0 or newer, then open this file again."
  finish 1
fi

node scripts/check-node-version.mjs
if [[ "$?" -ne 0 ]]; then
  finish 1
fi

if /usr/sbin/lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  if node scripts/check-office-running.mjs; then
    echo "OZMO is already running on this Mac."
    node scripts/check-office-host.mjs 2>/dev/null || true
    finish 0
  fi
  echo "Port 3000 is being used by another application, so OZMO was not started."
  echo "Close that application or change its port, then try again."
  finish 1
fi

if ! command -v pnpm >/dev/null 2>&1 &&
  [[ ! -f "${SERVICE_PNPM_SCRIPT}" ]]; then
  echo "pnpm is missing. Open Terminal once and run: npm install --global pnpm"
  finish 1
fi

if [[ ! -x "node_modules/.bin/wrangler" ]]; then
  echo "Preparing OZMO on this Mac for the first time…"
  run_pnpm install --frozen-lockfile || finish 1
fi

node scripts/check-office-host.mjs
CERTIFICATE_STATUS=$?
if [[ "${CERTIFICATE_STATUS}" -eq 2 ]]; then
  echo
  echo "Creating the private HTTPS certificate for this Mac…"
  run_pnpm https:setup || finish 1
elif [[ "${CERTIFICATE_STATUS}" -ne 0 ]]; then
  finish "${CERTIFICATE_STATUS}"
fi

echo
echo "Preparing the latest OZMO version…"
run_pnpm build || finish 1

echo
echo "Starting OZMO for the private office network…"
echo "If macOS asks about network access, choose Allow."
echo "Keep this window open. Press Control+C to stop the host."
echo

run_pnpm office:https
RESULT=$?

echo
echo "OZMO has stopped."
finish "${RESULT}"

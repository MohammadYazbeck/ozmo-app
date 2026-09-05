#!/bin/zsh

PROJECT_DIRECTORY="/Users/mwafaktarabien/.codex/.chatgpt-projects/g-p-6a64cbf5e2948191b9f4d73c86bcc46a/ozmo-app"
NODE_DIRECTORY="/Users/mwafaktarabien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
TOOLS_DIRECTORY="/Users/mwafaktarabien/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback"

export PATH="${NODE_DIRECTORY}:${TOOLS_DIRECTORY}:${PATH}"
cd "${PROJECT_DIRECTORY}" || exit 1

clear
echo "Starting OZMO…"
echo "Secure app:  https://192.168.1.196:3000"
echo "Phone setup: http://192.168.1.196:3001"
echo
echo "Keep this window open. Press Control+C to stop OZMO."
echo

pnpm office:https
RESULT=$?

echo
echo "OZMO stopped. Press any key to close this window."
read -k 1
exit "${RESULT}"

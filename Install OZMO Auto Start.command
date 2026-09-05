#!/bin/zsh

PROJECT_DIRECTORY="/Users/mwafaktarabien/.codex/.chatgpt-projects/g-p-6a64cbf5e2948191b9f4d73c86bcc46a/ozmo-app"
NODE_DIRECTORY="/Users/mwafaktarabien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
TOOLS_DIRECTORY="/Users/mwafaktarabien/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback"

export PATH="${NODE_DIRECTORY}:${TOOLS_DIRECTORY}:${PATH}"
cd "${PROJECT_DIRECTORY}" || exit 1

clear
echo "Installing OZMO automatic startup…"
echo
pnpm office:install-mac
RESULT=$?

echo
if [ "${RESULT}" -eq 0 ]; then
  echo "OZMO will now start automatically when you sign in to this Mac."
else
  echo "Automatic startup could not be installed. Keep this window open and share the message shown above."
fi
echo "Press any key to close this window."
read -k 1
exit "${RESULT}"

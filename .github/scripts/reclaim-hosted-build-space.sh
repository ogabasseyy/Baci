#!/usr/bin/env bash
set -euo pipefail

if [ "${RUNNER_ENVIRONMENT:-}" != "github-hosted" ]; then
  echo "Refusing hosted-runner cleanup outside a GitHub-hosted runner." >&2
  exit 1
fi

df -h .
# This web-only hosted job does not use .NET, Android, or Haskell.
sudo rm -rf -- /usr/share/dotnet /usr/local/lib/android /opt/ghc
df -h .

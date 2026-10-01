#!/usr/bin/env bash
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 [pnpm install args...]"
  exit 1
fi

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
exec "$script_dir/pnpm-install-with-retry.sh" --config.allowUnusedPatches=true "$@"

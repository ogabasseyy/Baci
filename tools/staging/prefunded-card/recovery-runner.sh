#!/usr/bin/env bash
set -euo pipefail
umask 077
worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

state_directory=/var/lib/baci-staging/prefunded-first-card
if [[ ! -d "$state_directory" || -L "$state_directory" ]]; then
  printf '{"status":"failed"}\n'
  exit 1
fi
if [[ "$(stat -c '%u:%a' "$state_directory" 2>/dev/null || true)" != "$(id -u):700" ]]; then
  printf '{"status":"failed"}\n'
  exit 1
fi
if ! command -v flock >/dev/null 2>&1; then
  printf '{"status":"failed"}\n'
  exit 1
fi

lock_file="$state_directory/runner.lock"
if [[ -L "$lock_file" ]]; then
  printf '{"status":"failed"}\n'
  exit 1
fi
exec 9>>"$lock_file"
chmod 600 "$lock_file"
if [[ "$(stat -c '%u:%a:%h' "$lock_file")" != "$(id -u):600:1" ]]; then
  printf '{"status":"failed"}\n'
  exit 1
fi
if ! flock -n 9; then
  printf '{"status":"busy"}\n'
  exit 0
fi

export PREFUNDED_CARD_CHECKOUT_RECOVERY_LOCK_HELD=1
export NODE_OPTIONS=--conditions=react-server
cd "$worktree"
exec pnpm --dir apps/web exec tsx src/scripts/run-prefunded-card-checkout-recovery.ts

#!/usr/bin/env bash
set -euo pipefail

output="$(
  PREFUNDED_CARD_CHECKOUT_RECOVERY_RUNNER_CONFIG=synthetic-invalid-config \
  PREFUNDED_CARD_CHECKOUT_RECOVERY_LOCK_HELD=1 \
  NODE_OPTIONS=--conditions=react-server \
    pnpm --dir apps/web exec tsx src/scripts/run-prefunded-card-checkout-recovery.ts 2>&1
)" && status=0 || status=$?
if [[ "$status" -ne 1 || "$output" != '{"status":"failed"}' ]]; then
  printf 'CLI smoke failed; output was not the redacted failure summary\n' >&2
  exit 1
fi
printf 'PASS react-server CLI imports and redacted invalid-config path\n'

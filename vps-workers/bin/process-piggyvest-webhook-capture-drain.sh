#!/usr/bin/env bash
# One bounded pass of the PiggyVest webhook capture drain, as the dedicated
# drain database login. A no-op that opens no connection unless
# PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED=true in the worker env file.
# Runbook: docs/piggyvest-webhook-capture-drain-runbook.md
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--once" ] && [ "$1" != "--readiness" ] && [ "$1" != "--plan" ]; }; then
  echo "[piggyvest-webhook-capture-drain] Usage: process-piggyvest-webhook-capture-drain.sh [--once|--readiness|--plan]" >&2
  exit 1
fi

export BACI_WORKER_PROFILE="${BACI_WORKER_PROFILE:-piggyvest-webhook-capture-drain}"
trap 'exit 124' TERM
trap 'status=$?; if [ "$status" -eq 124 ] || [ "$status" -eq 137 ] || [ "$status" -eq 143 ]; then echo "[piggyvest-webhook-capture-drain] pass timed out; any active lease will be reclaimed" >&2; fi' EXIT
"$SCRIPT_DIR/run-web-script.sh" piggyvest-webhook-capture-drain src/scripts/piggyvest-webhook-capture-drain-cli.ts "${1:---once}"

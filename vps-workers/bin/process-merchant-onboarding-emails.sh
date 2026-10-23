#!/usr/bin/env bash
set -euo pipefail
export BACI_WORKER_PROFILE=merchant-onboarding-emails
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/run-web-script.sh" process-merchant-onboarding-emails src/scripts/process-merchant-onboarding-emails.ts

#!/bin/bash
set -euo pipefail

unset PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN || true
source "$(dirname "$0")/quality-gate-environment.sh"
test "$PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN" = "false"

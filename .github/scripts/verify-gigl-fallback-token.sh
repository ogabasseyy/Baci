#!/usr/bin/env bash
# Ensures the prebuilt Vercel dotenv carries a GIGL fallback token entry.
# Usage: verify-gigl-fallback-token.sh <dotenv-path> (from the repo root).
#
# Mirror isExplicitlyDisabledEnv: only 0/false/off bypass this gate; an
# unset flag counts as enabled, matching the runtime default.
# The injector proves the Production key is DEFINED (Vercel pulls sensitive
# values blank); it cannot prove the value is real or unexpired. Operators
# must keep the same rotated worker JWT in Vercel Production and the VPS
# worker .env, or the retained manual fallback route returns 500.
set -euo pipefail

file="${1:?dotenv path is required}"
gigl_enabled="$(grep -E '^(export[[:space:]]+)?GIGL_ENABLED=' "$file" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"'"'" | tr '[:upper:]' '[:lower:]' | xargs)"
case "$gigl_enabled" in
  0|false|off) echo 'GIGL is not enabled; skipping fallback token injection.' ;;
  *) node .github/scripts/inject-prebuilt-env-secret.mjs GIGL_TRACKING_WORKER_TOKEN "$file" 'build-time-presence-stand-in-not-used-at-runtime-000000000000' ;;
esac

#!/usr/bin/env bash
# Ensures the prebuilt Vercel dotenv carries a GIGL fallback token entry.
# Usage: verify-gigl-fallback-token.sh <dotenv-path> (from the repo root).
#
# Mirror isExplicitlyDisabledEnv: only 0/false/off bypass this gate; an
# unset flag counts as enabled, matching the runtime default.
# The injector proves the Production key is DEFINED (Vercel pulls sensitive
# values blank or as the CLI 57 [SENSITIVE] marker); it cannot prove the value
# is real or unexpired. Operators
# must keep the same rotated worker JWT in Vercel Production and the VPS
# worker .env, or the retained manual fallback route returns 500.
# Rotation procedure (expiry check + rotate steps):
# vps-workers/docs/gigl-tracking-worker-token-rotation.md.
set -euo pipefail

file="${1:?dotenv path is required}"
# Shared dotenv reader (same parser as the latch-identity resolver, so
# the two can never disagree on export/quote/comment forms again). An
# absent flag prints nothing and counts as enabled (the runtime
# default); never add a naive `#`-cut here — dotenv keeps hashes
# inside quotes (`GIGL_ENABLED="off#x"` is enabled, not off).
# shellcheck source=.github/scripts/gigl-dotenv.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gigl-dotenv.sh"
gigl_enabled="$(gigl_dotenv_value "$file" 'GIGL_ENABLED' | tr '[:upper:]' '[:lower:]')"
# Trim like the runtime (isExplicitlyDisabledEnv) and the latch resolver:
# the reader preserves inner spaces of quoted values, so `GIGL_ENABLED=" OFF "`
# must count as disabled — without this the gate would treat an
# intentionally disabled environment as enabled and fail on the missing
# token, blocking production deployment.
gigl_enabled="$(printf '%s' "$gigl_enabled" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
case "$gigl_enabled" in
  0|false|off) echo 'GIGL is not enabled; skipping fallback token injection.' ;;
  *) node .github/scripts/inject-prebuilt-env-secret.mjs GIGL_TRACKING_WORKER_TOKEN "$file" 'build-time-presence-stand-in-not-used-at-runtime-000000000000' ;;
esac

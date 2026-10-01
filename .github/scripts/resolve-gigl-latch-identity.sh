#!/usr/bin/env bash
# Prints the GIGL latch identity for a worker directory as one line:
#   <scope> <token-fingerprint>
# scope is `disabled` or `enabled`; fingerprint is the sha256 of the
# effective GIGL_TRACKING_WORKER_TOKEN (empty string when absent). Exits
# nonzero when the fingerprint cannot be computed; callers fail closed.
# Usage:
#   resolve-gigl-latch-identity.sh <remote-dir>
#
# dotenv parity with the TypeScript smoke: a SET process variable wins over
# the <remote-dir>/.env file value (even when empty); the file value loses
# one layer of surrounding quotes. Scope matching is trim + lowercase +
# 0/false/off membership. The runner checkout never contains a CWD .env, so
# dotenv's third tier cannot contribute here.
set -euo pipefail

remote_dir="${1:?remote dir is required}"
env_file="$remote_dir/.env"

file_value() {
  local key="$1"
  [ -f "$env_file" ] || return 0
  local raw
  raw="$(awk -v key="$key" '
    index($0, key "=") == 1 {
      sub(key "=", "")
      print
      exit
    }
  ' "$env_file" 2>/dev/null || true)"
  raw="${raw%\"}"
  raw="${raw#\"}"
  raw="${raw%\'}"
  raw="${raw#\'}"
  printf '%s' "$raw"
}

effective() {
  local key="$1" value
  # A set process var wins even when empty (exact dotenv precedence).
  # printenv exits 0 for set-but-empty and 1 for unset on coreutils/BSD.
  # Capture through $( ) on both paths so trailing newlines are stripped
  # identically (fingerprint stability across file/process sources).
  if printenv "$key" >/dev/null 2>&1; then
    value="$(printenv "$key")"
  else
    value="$(file_value "$key")"
  fi
  printf '%s' "$value"
}

enabled_value="$(effective GIGL_ENABLED)"
normalized="$(printf '%s' "$enabled_value" | tr '[:upper:]' '[:lower:]')"
normalized="$(printf '%s' "$normalized" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
case "$normalized" in
  0 | false | off) scope="disabled" ;;
  *) scope="enabled" ;;
esac

if ! command -v python3 >/dev/null 2>&1; then
  echo "resolve-gigl-latch-identity: python3 is required" >&2
  exit 1
fi
fingerprint="$(effective GIGL_TRACKING_WORKER_TOKEN | python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.read().encode()).hexdigest())')"
if [[ ! "$fingerprint" =~ ^[0-9a-f]{64}$ ]]; then
  echo "resolve-gigl-latch-identity: fingerprint failed" >&2
  exit 1
fi

echo "$scope $fingerprint"

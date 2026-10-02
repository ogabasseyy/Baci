#!/usr/bin/env bash
# Prints the GIGL latch identity for a worker directory as one line:
#   <scope> <credential-fingerprint>
# scope is `disabled` or `enabled`; fingerprint is the sha256 of the
# effective Supabase URL, anon key, and worker token (newline-joined).
# Binding all three database credentials -- not just the token --
# forces a fresh smoke when the poller is repointed at an unverified
# endpoint. When the token is absent the fingerprint is the sha256 of
# the empty string regardless of URL/anon: nothing authenticates without
# the token, and the well-known empty value preserves vacuity detection
# (prepare defers exit-42 on a vacuous disabled latch). Exits nonzero
# when the fingerprint cannot be computed; callers fail closed.
# Usage:
#   resolve-gigl-latch-identity.sh <remote-dir>
#
# dotenv parity with the TypeScript smoke: a SET process variable wins over
# the <remote-dir>/.env file value (even when empty); the file parse
# comes from the shared gigl-dotenv.sh reader. Scope matching is trim +
# lowercase + 0/false/off membership. The runner checkout never contains
# a CWD .env, so dotenv's third tier cannot contribute here.
set -euo pipefail

remote_dir="${1:?remote dir is required}"
env_file="$remote_dir/.env"

# Shared dotenv reader (same parser as the fallback-token gate, so the
# two can never disagree on export/quote/comment forms again).
# shellcheck source=.github/scripts/gigl-dotenv.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gigl-dotenv.sh"

file_value() {
  gigl_dotenv_value "$env_file" "$1"
}

effective() {
  local key="$1" value
  # A set process var wins even when empty (exact dotenv precedence).
  # printenv exits 0 for set-but-empty and 1 for unset on coreutils/BSD.
  # Capture through $( ) on both paths so trailing newlines are stripped
  # identically (fingerprint stability across file/process sources).
  # File-authoritative mode (GIGL_ENV_FILE_AUTHORITATIVE=1, set at the
  # workflow job level) skips the process lookup: production identity
  # must fingerprint the installed dotenv, never a runner export.
  if [ "${GIGL_ENV_FILE_AUTHORITATIVE:-}" != "1" ] && printenv "$key" >/dev/null 2>&1; then
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
identity_token="$(effective GIGL_TRACKING_WORKER_TOKEN)"
if [ -z "$identity_token" ]; then
  fingerprint="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
else
  fingerprint="$({ effective NEXT_PUBLIC_SUPABASE_URL; echo; effective NEXT_PUBLIC_SUPABASE_ANON_KEY; echo; printf '%s' "$identity_token"; } | python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.read().encode()).hexdigest())')"
fi
if [[ ! "$fingerprint" =~ ^[0-9a-f]{64}$ ]]; then
  echo "resolve-gigl-latch-identity: fingerprint failed" >&2
  exit 1
fi

echo "$scope $fingerprint"

#!/usr/bin/env bash
# Prints only the GIGL scope and a fingerprint of the installed isolated
# worker environment. Used by the broker smoke and read-only readiness paths.
set -euo pipefail

worker_root="${1:-}"
[[ "$worker_root" == /* && "$worker_root" != *'/../'* && "$worker_root" != */.. ]] || exit 1
env_file="$worker_root/runtime/worker.env"
. "$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/gigl-dotenv.sh"

effective() {
  gigl_dotenv_value "$env_file" "$1"
}

enabled_value="$(effective GIGL_ENABLED)"
normalized="$(printf '%s' "$enabled_value" | tr '[:upper:]' '[:lower:]')"
normalized="$(printf '%s' "$normalized" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
case "$normalized" in
  0 | false | off) scope=disabled ;;
  *) scope=enabled ;;
esac

identity_token="$(effective GIGL_TRACKING_WORKER_TOKEN)"
if [ -z "$identity_token" ]; then
  fingerprint=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
else
  fingerprint="$(
    {
      effective NEXT_PUBLIC_SUPABASE_URL; echo
      effective NEXT_PUBLIC_SUPABASE_ANON_KEY; echo
      effective GIGL_BASE_URL; echo
      effective GIGL_EMAIL; echo
      effective GIGL_PASSWORD; echo
      printf '%s' "$identity_token"
    } | python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.read().encode()).hexdigest())'
  )"
fi
[[ "$fingerprint" =~ ^[0-9a-f]{64}$ ]] || exit 1
printf '%s %s\n' "$scope" "$fingerprint"

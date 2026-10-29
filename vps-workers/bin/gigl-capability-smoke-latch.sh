#!/usr/bin/env bash
# Broker-invoked GIGL capability smoke for the installed worker release.
# The authenticated root broker owns release/tracking locks and persists the
# latch after this scoped worker-UID process returns a valid local fingerprint.
set -euo pipefail

fail() {
  printf 'GIGL capability smoke/latch failed: %s\n' "$1" >&2
  exit 1
}

[ "$#" -eq 0 ] || fail 'unexpected arguments'
expected_sha="${BACI_EXPECTED_APP_SHA:-}"
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'expected SHA is invalid'
worker_root="${BACI_WORKER_ROOT:-/srv/baci-workers}"
[[ "$worker_root" == /* && "$worker_root" != *'/../'* && "$worker_root" != */.. ]] ||
  fail 'installed worker root is invalid'

current_sha="$(readlink "$worker_root/current" 2>/dev/null || true)"
[[ "$current_sha" == "releases/$expected_sha" ]] ||
  fail 'installed worker SHA does not match the authenticated release'

script_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
release_root="$(dirname -- "$script_dir")"
identity_script="$release_root/.github/scripts/resolve-isolated-gigl-latch-identity.sh"
smoke_script="$worker_root/current/bin/verify-gigl-tracking-worker-capability.sh"
worker_env="$worker_root/runtime/worker.env"
[ -f "$identity_script" ] || fail 'installed identity helper is missing'
[ -x "$smoke_script" ] || fail 'installed capability verifier is missing'
[ -r "$worker_env" ] || fail 'isolated worker environment is missing'
identity() {
  GIGL_ENV_FILE_AUTHORITATIVE=1 bash "$identity_script" "$worker_root" 2>/dev/null
}
identity_before="$(identity)" || fail 'installed GIGL identity is invalid'
[[ "$identity_before" =~ ^(enabled|disabled)\ ([0-9a-f]{64})$ ]] ||
  fail 'installed GIGL identity is invalid'

# The installed wrapper uses env -i with its GIGL allowlist. Suppress all
# subprocess output because database/provider errors can contain credentials.
if ! NODE_ENV=production \
  BACI_WORKER_PROFILE=gigl-tracking \
  BACI_WORKER_ENV="$worker_env" \
  GIGL_ENV_FILE_AUTHORITATIVE=1 \
  "$smoke_script" >/dev/null 2>&1; then
  fail 'restricted capability probe was rejected'
fi

identity_after="$(identity)" || fail 'installed GIGL identity changed during smoke'
[ "$identity_before" = "$identity_after" ] ||
  fail 'installed GIGL identity changed during smoke'
current_sha_after="$(readlink "$worker_root/current" 2>/dev/null || true)"
[ "$current_sha_after" = "$current_sha" ] ||
  fail 'installed worker SHA changed during smoke'

# The fingerprint crosses only the host-local pipe to the root broker, which
# persists the latch atomically. The trusted dispatcher strips this field.
printf '{"smokePassed":true,"scope":"%s","installedSha":"%s","credentialFingerprint":"%s"}\n' \
  "${identity_after%% *}" "$expected_sha" "${identity_after#* }"

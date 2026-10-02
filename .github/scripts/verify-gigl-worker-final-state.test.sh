#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
verifier="$script_dir/verify-gigl-worker-final-state.sh"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

fake_bin="$fixture_root/bin"
mkdir -p "$fake_bin"

cat >"$fake_bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail

payload="$(cat)"
printf '%s\n' "$payload" >>"$FAKE_QUERY_LOG"
if [ "${FAKE_CURL_FAIL:-0}" = '1' ]; then
  printf '%s\n' "$FAKE_ERROR_RESPONSE"
  exit 22
fi
printf '%s\n' "$FAKE_RESPONSE"
FAKE_CURL
chmod +x "$fake_bin/curl"

run_verifier() {
  FAKE_QUERY_LOG="$fixture_root/queries.log" \
    FAKE_RESPONSE="$1" \
    FAKE_CURL_FAIL="${2:-0}" \
    FAKE_ERROR_RESPONSE='{"message":"boom"}' \
    SUPABASE_ACCESS_TOKEN='test-token' \
    SUPABASE_PROJECT_REF='test-ref' \
    PATH="$fake_bin:$PATH" \
    bash "$verifier" >"$fixture_root/out.log" 2>&1
}

pass=0
fail=0
check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL: $name (expected $expected, got $actual)" >&2
  fi
}

# Final state: NOLOGIN, no password, hook installed and active, grant held.
if run_verifier '[{"login":false,"has_password":false,"hooks":1,"active_hook":1,"grants":1}]'; then
  status=0
else
  status=$?
fi
check 'accepts final state' 0 "$status"
grep -q 'least-privilege final state verified' "$fixture_root/out.log"
check 'prints verification' 0 "$?"
grep -q "rolname = 'gigl_tracking_worker'" "$fixture_root/queries.log"
check 'queries the worker role quoted' 0 "$?"
grep -q 'pg_db_role_setting' "$fixture_root/queries.log"
check 'queries the active hook setting' 0 "$?"
grep -q 'pgrst.db_pre_request=public.enforce_gigl_tracking_worker_request_scope' "$fixture_root/queries.log"
check 'pins the exact hook setting value' 0 "$?"
if grep -q '\$role' "$fixture_root/queries.log"; then literal=0; else literal=1; fi
check 'leaves no uninterpolated jq variable in SQL' 1 "$literal"

# Interim LOGIN window (current production shape): must block.
if run_verifier '[{"login":true,"has_password":true,"hooks":0,"active_hook":0,"grants":0}]'; then
  status=0
else
  status=$?
fi
check 'rejects interim LOGIN state' 1 "$status"

# Each missing piece blocks independently.
if run_verifier '[{"login":false,"has_password":true,"hooks":1,"active_hook":1,"grants":1}]'; then
  status=0
else
  status=$?
fi
check 'rejects lingering password' 1 "$status"

if run_verifier '[{"login":false,"has_password":false,"hooks":0,"active_hook":0,"grants":1}]'; then
  status=0
else
  status=$?
fi
check 'rejects missing hook' 1 "$status"

# Installed but inactive: the hook function exists and the grant is live,
# but the authenticator setting was RESET — the exact gap a function-only
# count misses, and the live-grant state where it matters most.
if run_verifier '[{"login":false,"has_password":false,"hooks":1,"active_hook":0,"grants":1}]'; then
  status=0
else
  status=$?
fi
check 'rejects installed-but-inactive hook' 1 "$status"

if run_verifier '[{"login":false,"has_password":false,"hooks":1,"active_hook":1,"grants":0}]'; then
  status=0
else
  status=$?
fi
check 'rejects missing grant' 1 "$status"

if run_verifier '[]'; then
  status=0
else
  status=$?
fi
check 'rejects missing role' 1 "$status"

if run_verifier '{"message":"boom"}'; then
  status=0
else
  status=$?
fi
check 'rejects error-object body' 1 "$status"

if run_verifier '[]' 1; then
  status=0
else
  status=$?
fi
check 'rejects curl failure' 1 "$status"

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]

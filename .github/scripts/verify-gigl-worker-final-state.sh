#!/usr/bin/env bash
# Verifies the GIGL tracking worker reached its least-privilege final state
# after migrations: NOLOGIN, no password, scope hook installed, and
# authenticator membership held. Runs in db-migrations after pending
# migrations apply; exits nonzero while the interim LOGIN window is still
# open so deploy-production stays blocked.
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF is required}"

API="https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query"

# NOTE: jq interpolates only via \(...), and the role needs SQL single
# quotes: a bare $role would ship literally and the API would reject
# every query. The value is a fixed identifier, never user input.
body="$(jq -n --arg role gigl_tracking_worker '{query: "SELECT rolcanlogin AS login, (rolpassword IS NOT NULL) AS has_password, (SELECT count(*) FROM pg_proc WHERE proname = \u0027enforce_gigl_tracking_worker_request_scope\u0027) AS hooks, (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE r.rolname = \u0027\($role)\u0027 AND u.rolname = \u0027authenticator\u0027) AS grants FROM pg_roles WHERE rolname = \u0027\($role)\u0027"}')"

response="$(curl --fail-with-body --silent --show-error -X POST \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data-binary @- "$API" <<<"$body")" || {
  echo "::error::GIGL final-state query did not succeed; refusing to proceed." >&2
  exit 1
}

if ! jq -e 'type == "array" and length == 1 and .[0].login == false and .[0].has_password == false and .[0].hooks == 1 and .[0].grants == 1' >/dev/null 2>&1 <<<"$response"; then
  echo "::error::GIGL worker is not in least-privilege final state (expected NOLOGIN, no password, scope hook installed, authenticator grant); refusing to proceed." >&2
  exit 1
fi

echo "GIGL worker least-privilege final state verified."

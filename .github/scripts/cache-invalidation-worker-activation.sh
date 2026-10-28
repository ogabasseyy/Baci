#!/usr/bin/env bash
# Production membership changes require the signed coordinator job and its
# persistent exact-SHA release lock; no standalone/operator bypass exists.
set -euo pipefail

readonly EXPECTED_PROJECT_REF=aivqthbxdshhltbwipbr
readonly MGMT_ENDPOINT="https://api.supabase.com/v1/projects/${EXPECTED_PROJECT_REF}/database/query"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTIVATION_CONFIG=''

cleanup() {
  [[ -z "$ACTIVATION_CONFIG" ]] || rm -f -- "$ACTIVATION_CONFIG"
}
trap cleanup EXIT HUP INT TERM

usage() {
  echo "Usage: $0 activate (membership revocation is unsupported until a compatible app rollback is verified)" >&2
  exit 2
}

fail() {
  echo "Cache worker activation: $*" >&2
  exit 1
}

# Reject revocation before checking credentials, authorizing a job, syncing a
# secret, or contacting the Management API. The live cache route currently
# depends on this role, and no compatible app rollback proof exists.
case "${1:-}" in
  activate) [[ "$#" == 1 ]] || usage ;;
  *) usage ;;
esac

[[ "${SUPABASE_PROJECT_REF:-}" == "$EXPECTED_PROJECT_REF" ]] ||
  fail 'SUPABASE_PROJECT_REF does not match the pinned production project'
[[ "${SUPABASE_ACCESS_TOKEN:-}" =~ ^[A-Za-z0-9._-]{20,}$ ]] ||
  fail 'SUPABASE_ACCESS_TOKEN is missing or malformed'
[[ "${NEXT_PUBLIC_SUPABASE_URL:-}" == "https://${EXPECTED_PROJECT_REF}.supabase.co" ||
  "${NEXT_PUBLIC_SUPABASE_URL:-}" == "https://${EXPECTED_PROJECT_REF}.supabase.co/" ]] ||
  fail 'NEXT_PUBLIC_SUPABASE_URL does not match the pinned production project'
[[ -n "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ]] ||
  fail 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'

# This command validates the signed reusable-workflow job identity against the
# persistent VPS lock before any probe or Management API call.
node "$SCRIPT_DIR/production-release-lock.mjs" authorize-cache-worker-action

management_query() {
  local sql="$1" response status body
  ACTIVATION_CONFIG="$(mktemp)" || fail 'could not create a protected Management API config'
  chmod 0600 "$ACTIVATION_CONFIG"
  printf 'header = "Authorization: Bearer %s"\n' "$SUPABASE_ACCESS_TOKEN" > "$ACTIVATION_CONFIG"
  if ! response="$(jq -n --arg query "$sql" '{query: $query}' | curl \
    --config "$ACTIVATION_CONFIG" --silent --show-error --max-time 30 \
    --request POST \
    --header 'Content-Type: application/json' \
    --data-binary @- \
    --write-out '\n%{http_code}' \
    "$MGMT_ENDPOINT" 2>/dev/null)"; then
    cleanup
    ACTIVATION_CONFIG=''
    return 1
  fi
  cleanup
  ACTIVATION_CONFIG=''
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  [[ "$status" =~ ^2[0-9][0-9]$ ]] || return 1
  printf '%s' "$body"
}

membership_state() {
  local response value
  response="$(management_query "SELECT pg_catalog.pg_has_role('authenticator', 'cache_invalidation_worker', 'MEMBER') AS is_member")" || return 1
  value="$(jq -er 'if type == "array" and length == 1 and (.[0].is_member | type) == "boolean" then (.[0].is_member | tostring) else error("unexpected membership response") end' <<<"$response" 2>/dev/null)" ||
    return 1
  printf '%s' "$value"
}

# Serialize role membership transitions across operators. The advisory lock is
# transaction-scoped, so every state change and the lock acquisition share the
# Management API query transaction. It intentionally does not claim to lock
# the multi-minute probes; those are sampled observations only.
serialized_membership_change() {
  management_query "DO \$cache_worker_membership\$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock(20261028, 41); GRANT cache_invalidation_worker TO authenticator; END \$cache_worker_membership\$" >/dev/null
}

activate() {
  [[ -n "${CACHE_INVALIDATION_WORKER_TOKEN:-}" ]] ||
    fail 'CACHE_INVALIDATION_WORKER_TOKEN must be provisioned before activation'

  # Repeated sampled canary responses are required before the grant. The
  # public endpoint does not expose replica identity, so this is not a
  # per-replica proof.
  "$SCRIPT_DIR/probe-cache-invalidation-hook-scope.sh"

  local before_state after_state
  before_state="$(membership_state)" ||
    fail 'Could not verify cache worker membership before activation'
  if [[ "$before_state" == true ]]; then
    echo 'Cache worker membership is already active; verifying the live capability.'
  else
    if serialized_membership_change; then
      echo 'Cache worker membership was granted after the sampled scope-convergence gate.'
    else
      # The Management API may commit a query and lose its response. Reconcile
      # the database state before deciding whether to verify or roll back.
      after_state="$(membership_state)" ||
        fail 'Grant response and membership reconciliation are ambiguous; do not deploy or retry until an operator verifies membership'
      if [[ "$after_state" == false ]]; then
        fail 'Grant request failed and the role remains inactive'
      fi
      echo 'Grant response was ambiguous but the database shows membership; verifying before proceeding.'
    fi
  fi

  if ! "$SCRIPT_DIR/probe-cache-invalidation-worker-capability.sh"; then
    fail 'Capability verification failed; membership state was left unchanged to avoid revoking a concurrent operator grant. Reconcile under the serialized release gate.'
  fi

  echo 'Cache worker activation preflight passed. Keep the JWT in the web runtime only.'
}

activate

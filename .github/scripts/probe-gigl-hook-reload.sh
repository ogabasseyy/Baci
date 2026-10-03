#!/usr/bin/env bash
# Proves PostgREST LOADED the GIGL request-scope hook before the isolate
# migration grants membership. The deploy runs the migration applier only
# through the restore (MIGRATION_MAX_VERSION=20260805113000), then this
# probe, then the applier for the rest: the grant can never commit ahead
# of an unloaded hook, because a hook that never loads fails this step
# while the isolate migration is still unapplied. Anonymous POST to the
# canary path matches no real RPC, so 42501-with-canary-message is the
# ack and anything else (404, other errors, connection failure) means
# not-loaded-yet. Skips fast once the isolate migration is recorded.
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF is required}"
: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is required}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?NEXT_PUBLIC_SUPABASE_ANON_KEY is required}"

ISOLATE_VERSION=20260805170000
CANARY_PATH=__gigl_hook_reload_canary__
CANARY_MESSAGE='GIGL hook reload canary observed'
MGMT_BASE="${SUPABASE_MGMT_API_BASE:-https://api.supabase.com}"
DEADLINE_S="${GIGL_HOOK_PROBE_DEADLINE_S:-240}"
INTERVAL_S="${GIGL_HOOK_PROBE_INTERVAL_S:-5}"

if ! [ "$DEADLINE_S" -ge 1 ] 2>/dev/null || ! [ "$INTERVAL_S" -ge 0 ] 2>/dev/null; then
  echo "::error::GIGL hook probe deadline/interval must be non-negative numbers" >&2
  exit 1
fi

mgmt_api="${MGMT_BASE}/v1/projects/${SUPABASE_PROJECT_REF}/database/query"
recorded_body="$(jq -n --arg version "$ISOLATE_VERSION" '{query: "SELECT count(*) AS applied FROM supabase_migrations.schema_migrations WHERE version = \u0027\($version)\u0027"}')"
recorded_response="$(curl --fail-with-body --silent --show-error -X POST \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data-binary @- "$mgmt_api" <<<"$recorded_body")" || {
  echo "::error::GIGL hook probe could not check the isolate migration; refusing to proceed." >&2
  exit 1
}
# count(*) is bigint/int8, serialized as a JSON string ("1"); normalize
# with tonumber like the final-state check so both shapes verify.
if ! applied="$(jq -re 'if type == "array" and length == 1 then ((.[0].applied | tonumber) | tostring) else error("bad shape") end' <<<"$recorded_response" 2>/dev/null)"; then
  echo "::error::GIGL hook probe got an unreadable isolate-migration response; refusing to proceed." >&2
  exit 1
fi
if [ "$applied" -ge 1 ]; then
  echo "Isolate migration ${ISOLATE_VERSION} is already recorded; skipping hook reload probe."
  exit 0
fi

url="${NEXT_PUBLIC_SUPABASE_URL%/}/rest/v1/rpc/${CANARY_PATH}"
start="$(date +%s)"
attempt=0
while :; do
  attempt=$((attempt + 1))
  body="$(curl --silent --show-error --max-time 15 -X POST \
    -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
    -H 'Content-Type: application/json' \
    -d '{}' "$url" 2>/dev/null)" || body=''
  # Status-agnostic on purpose (mirrors the supabase-js scope probe):
  # PostgREST versions map raised 42501 to different HTTP statuses,
  # but the JSON body code/message is the stable contract.
  if [ -n "$body" ] && jq -e --arg msg "$CANARY_MESSAGE" \
    'type == "object" and .code == "42501" and ((.message // "") | contains($msg))' \
    >/dev/null 2>&1 <<<"$body"; then
    echo "GIGL hook reload acknowledged after ${attempt} attempt(s)."
    exit 0
  fi
  if [ "$(($(date +%s) - start))" -ge "$DEADLINE_S" ]; then
    echo "::error::PostgREST never served the GIGL hook reload canary within ${DEADLINE_S}s (expected anonymous POST ${CANARY_PATH} to answer 42501 '${CANARY_MESSAGE}'); the isolate grant is NOT applied. Check PostgREST health and config reload, then re-run the deploy." >&2
    exit 1
  fi
  sleep "$INTERVAL_S"
done

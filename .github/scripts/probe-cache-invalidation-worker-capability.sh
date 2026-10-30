#!/usr/bin/env bash
# Verify that the cache-worker JWT is active only behind the loaded shared
# PostgREST scope hook before deploying a route that requires this capability.
set -euo pipefail

: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is required}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?NEXT_PUBLIC_SUPABASE_ANON_KEY is required}"
: "${CACHE_INVALIDATION_WORKER_TOKEN:?CACHE_INVALIDATION_WORKER_TOKEN is required}"

readonly CANARY=__cache_invalidation_hook_reload_canary__
readonly ALLOWED_RPC=has_cache_invalidation_dead_letters
readonly DENIED_PATH='products?select=id&limit=0'
readonly CANARY_MESSAGE='CACHE INVALIDATION hook reload canary observed'
readonly SCOPE_MESSAGE='Cache invalidation worker request is outside its capability scope'
readonly DEADLINE_S="${CACHE_WORKER_PROBE_DEADLINE_S:-900}"
readonly INTERVAL_S="${CACHE_WORKER_PROBE_INTERVAL_S:-2}"
readonly UNANIMITY_S="${CACHE_WORKER_PROBE_UNANIMITY_S:-300}"

for value in "$DEADLINE_S" "$INTERVAL_S" "$UNANIMITY_S"; do
  [[ "$value" =~ ^[0-9]+$ ]] || {
    echo 'Cache worker probe timing values must be nonnegative integers.' >&2
    exit 1
  }
done
(( DEADLINE_S >= 1 && UNANIMITY_S >= 1 )) || {
  echo 'Cache worker probe deadline and sample window must be positive.' >&2
  exit 1
}

base_url="${NEXT_PUBLIC_SUPABASE_URL%/}/rest/v1"

request() {
  local auth_token="$1" endpoint="$2" method="$3" response status body
  local -a request_body=()
  [[ "$method" == POST ]] && request_body=(-d '{}')
  response="$(curl --silent --show-error --max-time 15 \
    -X "$method" \
    -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${auth_token}" \
    -H 'Content-Type: application/json' \
    "${request_body[@]}" \
    -w '\n%{http_code}' \
    "${base_url}/${endpoint}" 2>/dev/null)" || return 1
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  printf '%s\n%s' "$status" "$body"
}

is_canary_ack() {
  local response status body
  response="$(request "$NEXT_PUBLIC_SUPABASE_ANON_KEY" "rpc/$CANARY" POST)" || return 1
  status="${response%%$'\n'*}"
  body="${response#*$'\n'}"
  [[ "$status" =~ ^4[0-9][0-9]$ ]] && jq -e --arg message "$CANARY_MESSAGE" \
    '.code == "42501" and ((.message // "") | contains($message))' \
    >/dev/null 2>&1 <<<"$body"
}

is_worker_capability_live() {
  local response status body
  response="$(request "$CACHE_INVALIDATION_WORKER_TOKEN" "rpc/$ALLOWED_RPC" POST)" || return 1
  status="${response%%$'\n'*}"
  body="${response#*$'\n'}"
  [[ "$status" =~ ^2[0-9][0-9]$ ]] && jq -e 'type == "boolean"' >/dev/null 2>&1 <<<"$body"
}

is_out_of_scope_denied() {
  local response status body
  response="$(request "$CACHE_INVALIDATION_WORKER_TOKEN" "$DENIED_PATH" GET)" || return 1
  status="${response%%$'\n'*}"
  body="${response#*$'\n'}"
  [[ "$status" =~ ^4[0-9][0-9]$ ]] && jq -e --arg message "$SCOPE_MESSAGE" \
    '.code == "42501" and ((.message // "") | contains($message))' \
    >/dev/null 2>&1 <<<"$body"
}

start="$(date +%s)"
unanimous_since=''
attempt=0
while :; do
  attempt=$((attempt + 1))
  if is_canary_ack && is_worker_capability_live && is_out_of_scope_denied; then
    now="$(date +%s)"
    if [[ -z "$unanimous_since" ]]; then
      unanimous_since="$now"
      echo "Cache worker capability and hook scope observed; requiring ${UNANIMITY_S}s of uninterrupted sampled passes."
    fi
    if (( now - unanimous_since >= UNANIMITY_S )); then
      echo "Cache worker capability sample gate passed after ${attempt} complete probe(s)."
      exit 0
    fi
  else
    unanimous_since=''
    echo "Cache worker capability probe ${attempt} did not prove the full scope; gate remains closed."
  fi
  now="$(date +%s)"
  if (( now - start >= DEADLINE_S )); then
    echo '::error::Cache worker role, allowed RPC, and request-scope hook did not converge; do not deploy the cache drain route.' >&2
    exit 1
  fi
  sleep "$INTERVAL_S"
done

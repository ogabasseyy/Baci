#!/usr/bin/env bash
# Read-only repeated canary sample. Must pass before membership activation.
set -euo pipefail

: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is required}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?NEXT_PUBLIC_SUPABASE_ANON_KEY is required}"

readonly EXPECTED_HOST=aivqthbxdshhltbwipbr.supabase.co
readonly CANARY=__cache_invalidation_hook_reload_canary__
readonly CANARY_MESSAGE='CACHE INVALIDATION hook reload canary observed'
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

url="$NEXT_PUBLIC_SUPABASE_URL"
if [[ "$url" != https://$EXPECTED_HOST && "$url" != https://$EXPECTED_HOST/ ]]; then
  echo 'Cache worker hook probe refuses a non-production Supabase origin.' >&2
  exit 1
fi
canary_url="${url%/}/rest/v1/rpc/${CANARY}"

canary_acknowledged() {
  local response body status
  response="$(curl --silent --show-error --max-time 15 -X POST \
    -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
    -H 'Content-Type: application/json' \
    -d '{}' -w '\n%{http_code}' "$canary_url" 2>/dev/null)" || return 1
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  [[ "$status" =~ ^4[0-9][0-9]$ ]] && jq -e --arg message "$CANARY_MESSAGE" \
    '.code == "42501" and ((.message // "") | contains($message))' \
    >/dev/null 2>&1 <<<"$body"
}

start="$(date +%s)"
unanimous_since=''
attempt=0
while :; do
  attempt=$((attempt + 1))
  now="$(date +%s)"
  if canary_acknowledged; then
    if [[ -z "$unanimous_since" ]]; then
      unanimous_since="$now"
      echo "Cache scope canary acknowledged; requiring ${UNANIMITY_S}s of uninterrupted sampled acknowledgements."
    fi
    if (( now - unanimous_since >= UNANIMITY_S )); then
      echo "Cache request-scope hook sample gate passed after ${attempt} canary probe(s)."
      exit 0
    fi
  else
    unanimous_since=''
    echo "Cache scope canary probe ${attempt} did not acknowledge the hook; gate remains closed."
  fi
  now="$(date +%s)"
  if (( now - start >= DEADLINE_S )); then
    echo '::error::Cache request-scope hook did not converge; no role membership was changed.' >&2
    exit 1
  fi
  sleep "$INTERVAL_S"
done

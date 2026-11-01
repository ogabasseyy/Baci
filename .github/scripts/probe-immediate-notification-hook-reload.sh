#!/usr/bin/env bash
# Observe the complete request guard across routed PostgREST responses before
# separately authorizing role membership. This script never grants the role.
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?missing management token}"
: "${SUPABASE_PROJECT_REF:?missing project reference}"
: "${NEXT_PUBLIC_SUPABASE_URL:?missing database URL}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?missing anonymous key}"

[[ "$SUPABASE_PROJECT_REF" =~ ^[a-z0-9]+$ ]] || { echo 'Invalid project reference' >&2; exit 1; }
mgmt_base="${SUPABASE_MGMT_API_BASE:-https://api.supabase.com}"
expected="https://${SUPABASE_PROJECT_REF}.supabase.co"
if [[ "${NEXT_PUBLIC_SUPABASE_URL%/}" != "$expected" || "$mgmt_base" != 'https://api.supabase.com' ]]; then
  # Only isolated test servers may override endpoint pins, and only when both
  # endpoints are loopback. The production credential never follows a URL.
  if [[ "${NODE_ENV:-}" != 'test' || "${IMMEDIATE_NOTIFICATION_PROBE_ALLOW_LOCAL_TEST:-}" != '1' ||
    ! "${NEXT_PUBLIC_SUPABASE_URL%/}" =~ ^http://127\.0\.0\.1:[0-9]+$ ||
    ! "$mgmt_base" =~ ^http://127\.0\.0\.1:[0-9]+$ ]]; then
    echo 'Probe endpoint does not match the target project' >&2
    exit 1
  fi
fi

deadline="${IMMEDIATE_NOTIFICATION_PROBE_DEADLINE_S:-900}"
unanimity="${IMMEDIATE_NOTIFICATION_PROBE_UNANIMITY_S:-300}"
interval="${IMMEDIATE_NOTIFICATION_PROBE_INTERVAL_S:-2}"
renotify="${IMMEDIATE_NOTIFICATION_PROBE_RENOTIFY_S:-60}"
for value in "$deadline" "$unanimity" "$interval" "$renotify"; do
  [[ "$value" =~ ^[0-9]+$ ]] || { echo 'Invalid probe interval' >&2; exit 1; }
done
(( deadline >= 1 && unanimity >= 1 && renotify >= 1 )) || { echo 'Invalid probe interval' >&2; exit 1; }
if (( interval == 0 )) && [[ "${NODE_ENV:-}" != 'test' || "${IMMEDIATE_NOTIFICATION_PROBE_ALLOW_LOCAL_TEST:-}" != '1' ]]; then
  echo 'Zero probe interval is limited to local tests' >&2
  exit 1
fi

notify() {
  local body
  body="$(jq -n '{query:"NOTIFY pgrst, '\''reload config'\''; NOTIFY pgrst, '\''reload schema'\'';"}')"
  curl --fail --silent --show-error --max-time 15 -X POST \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H 'Content-Type: application/json' \
    --data-binary "$body" "${mgmt_base}/v1/projects/${SUPABASE_PROJECT_REF}/database/query" >/dev/null 2>&1
}
notify || echo 'Warning: could not resend PostgREST reload notifications' >&2
start="$(date +%s)"
last_notify="$start"
unanimous_since=''
url="${NEXT_PUBLIC_SUPABASE_URL%/}/rest/v1/rpc/__immediate_notification_redrive_complete_hook_canary__"
while :; do
  body="$(curl --silent --show-error --max-time 15 -X POST \
    -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" -H "Authorization: Bearer ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
    -H 'Content-Type: application/json' -d '{}' "$url" 2>/dev/null)" || body=''
  now="$(date +%s)"
  if jq -e 'type == "object" and .code == "42501" and .message == "IMMEDIATE NOTIFICATION COMPLETE hook reload canary observed"' >/dev/null 2>&1 <<<"$body"; then
    [[ -n "$unanimous_since" ]] || unanimous_since="$now"
    if (( now - unanimous_since >= unanimity )); then
      echo "Complete hook acknowledged for ${unanimity}s; sticky routing can hide stale replicas."
      exit 0
    fi
  else
    unanimous_since=''
  fi
  if (( now - start >= deadline )); then
    echo 'Complete hook did not converge; role activation remains prohibited' >&2
    exit 1
  fi
  if (( now - last_notify >= renotify )); then
    notify || echo 'Warning: PostgREST reload notification failed' >&2
    last_notify="$now"
  fi
  sleep "$interval"
done

#!/usr/bin/env bash
# Proves the PostgREST FLEET loaded the GIGL request-scope hook before the
# isolate migration grants membership. The deploy runs the migration
# applier only through the restore (MIGRATION_MAX_VERSION=20260805113000),
# then this probe, then the applier for the rest: the grant can never
# commit ahead of an unloaded hook, because a hook that never loads fails
# this step while the isolate migration is still unapplied. Anonymous POST
# to the canary path MUST name a real RPC (the restore migration creates
# it): PostgREST resolves the action plan before invoking db_pre_request,
# so a nonexistent path would answer PGRST202 with the hook never firing
# and the probe could never ack. 42501-with-canary-message is the ack
# (the loaded hook shadowing the real function); anything else — 404
# (schema not yet reloaded), the bare canary constant (schema fresh,
# hook stale), other errors, connection failure — means not-loaded-yet.
# Skips fast once the isolate migration is recorded.
#
# Fleet convergence (not first-ack): a single ack proves only the routed
# replica, so after the first ack this probe requires UNANIMITY_S of
# consecutive acks with zero non-acks — any non-ack resets the clock. A
# stale replica answers 404 to every canary routed its way, so it is
# detected unless it dodges every probe in the window: ~150 probes per
# window at the defaults, i.e. escape probability ((R-1)/R)^150 for one
# stale replica among R under uniform routing (≈1e-7 at R=10, ~0 below
# that). The probe also re-sends BOTH reload notifications (config
# AND schema — separate PostgREST listener payloads) at start and
# every RENOTIFY_S (best-effort): replicas that missed the
# restore-time signals reload now instead of failing the window.
# Residuals: an
# IP-sticky load balancer would collapse unanimity to single-replica
# evidence (then the defense degrades to re-notify plus window); a
# replica that cannot reach PostgreSQL at all fails closed on hook
# execution (500), never unconfined.
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF is required}"
: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is required}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?NEXT_PUBLIC_SUPABASE_ANON_KEY is required}"

ISOLATE_VERSION=20260805170000
CANARY_PATH=__gigl_hook_reload_canary__
CANARY_MESSAGE='GIGL hook reload canary observed'
MGMT_BASE="${SUPABASE_MGMT_API_BASE:-https://api.supabase.com}"
DEADLINE_S="${GIGL_HOOK_PROBE_DEADLINE_S:-900}"
INTERVAL_S="${GIGL_HOOK_PROBE_INTERVAL_S:-2}"
UNANIMITY_S="${GIGL_HOOK_PROBE_UNANIMITY_S:-300}"
RENOTIFY_S="${GIGL_HOOK_PROBE_RENOTIFY_S:-60}"

if ! [ "$DEADLINE_S" -ge 1 ] 2>/dev/null || ! [ "$INTERVAL_S" -ge 0 ] 2>/dev/null \
  || ! [ "$UNANIMITY_S" -ge 1 ] 2>/dev/null || ! [ "$RENOTIFY_S" -ge 1 ] 2>/dev/null; then
  echo "::error::GIGL hook probe deadline/interval/unanimity/renotify must be positive numbers" >&2
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

renotify_postgrest() {
  local signal payload
  # Config and schema notifications are SEPARATE (PostgREST listener
  # docs): a replica that missed the restore-time schema reload keeps
  # 404ing the canary until it hears 'reload schema' — config-only
  # re-notifies can never heal it, and unanimity would time out. Both
  # signals, every time.
  for signal in 'reload config' 'reload schema'; do
    payload="$(jq -n --arg signal "$signal" '{query: ("NOTIFY pgrst, \u0027" + $signal + "\u0027")}')" || return 1
    curl --fail-with-body --silent --show-error -X POST \
      -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
      -H 'Content-Type: application/json' \
      --data-binary @- "$mgmt_api" <<<"$payload" >/dev/null 2>&1 || return 1
  done
}

# Fresh reload signals for replicas that missed the restore-time
# notifies (restarting or LISTEN-flapping then). Best-effort: the
# unanimity window below is the actual gate, so a failed re-notify
# warns and the probe still verifies empirically.
if renotify_postgrest; then
  echo "Signaled PostgREST config+schema reload."
else
  echo "::warning::GIGL hook probe could not re-send the reload signals; relying on the restore-time signals plus unanimous observation."
fi

url="${NEXT_PUBLIC_SUPABASE_URL%/}/rest/v1/rpc/${CANARY_PATH}"
start="$(date +%s)"
last_notify="$start"
unanimous_since=""
ever_acked=0
attempt=0
while :; do
  attempt=$((attempt + 1))
  body="$(curl --silent --show-error --max-time 15 -X POST \
    -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
    -H 'Content-Type: application/json' \
    -d '{}' "$url" 2>/dev/null)" || body=''
  now="$(date +%s)"
  # Status-agnostic on purpose (mirrors the supabase-js scope probe):
  # PostgREST versions map raised 42501 to different HTTP statuses,
  # but the JSON body code/message is the stable contract.
  if [ -n "$body" ] && jq -e --arg msg "$CANARY_MESSAGE" \
    'type == "object" and .code == "42501" and ((.message // "") | contains($msg))' \
    >/dev/null 2>&1 <<<"$body"; then
    ever_acked=1
    if [ -z "$unanimous_since" ]; then
      unanimous_since="$now"
      echo "First canary ack on attempt ${attempt}; requiring ${UNANIMITY_S}s of unanimous acks."
    fi
    if [ "$((now - unanimous_since))" -ge "$UNANIMITY_S" ]; then
      echo "GIGL hook reload acknowledged fleet-wide: ${UNANIMITY_S}s unanimous after ${attempt} attempt(s)."
      exit 0
    fi
  else
    if [ -n "$unanimous_since" ]; then
      echo "Non-ack on attempt ${attempt} (${body:0:160}); unanimity clock reset."
      unanimous_since=""
    else
      echo "Attempt ${attempt}: no ack yet (${body:0:160})."
    fi
  fi
  if [ "$((now - start))" -ge "$DEADLINE_S" ]; then
    if [ "$ever_acked" = 1 ]; then
      echo "::error::PostgREST canary acks never reached ${UNANIMITY_S}s unanimous within ${DEADLINE_S}s (a stale replica kept answering); the isolate grant is NOT applied. Check PostgREST fleet health and config reload, then re-run the deploy." >&2
    else
      echo "::error::PostgREST never served the GIGL hook reload canary within ${DEADLINE_S}s (expected anonymous POST ${CANARY_PATH} to answer 42501 '${CANARY_MESSAGE}'); the isolate grant is NOT applied. Check PostgREST health and config reload, then re-run the deploy." >&2
    fi
    exit 1
  fi
  if [ "$((now - last_notify))" -ge "$RENOTIFY_S" ]; then
    renotify_postgrest && last_notify="$now" || echo "::warning::GIGL hook probe reload re-notify failed; continuing to observe."
  fi
  sleep "$INTERVAL_S"
done

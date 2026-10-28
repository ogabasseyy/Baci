#!/usr/bin/env bash
# Block cart quota activation if expired counters cannot be purged.
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF is required}"
deadline="${CART_QUOTA_CRON_DEADLINE_S:-720}"
interval="${CART_QUOTA_CRON_INTERVAL_S:-10}"
if ! [[ "$deadline" =~ ^[0-9]+$ && "$interval" =~ ^[0-9]+$ ]] || [ "$deadline" -lt 1 ]; then
  echo "::error::Invalid cart quota maintenance probe timing." >&2
  exit 1
fi
endpoint="${SUPABASE_MGMT_API_BASE:-https://api.supabase.com}/v1/projects/${SUPABASE_PROJECT_REF}/database/query"
query() {
  local payload
  payload="$(jq -n --arg sql "$1" '{query:$sql}')"
  curl --fail-with-body --silent --show-error --max-time 15 -X POST \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H 'Content-Type: application/json' --data-binary "$payload" "$endpoint"
}

extension="$(query "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') AS installed")" || {
  echo "::error::Could not inspect pg_cron." >&2
  exit 1
}
if ! jq -e 'type == "array" and length == 1 and .[0].installed == true' >/dev/null <<<"$extension"; then
  echo "::error::pg_cron is unavailable; cart quota activation is blocked." >&2
  exit 1
fi

sql="SELECT count(*) = 1 AND coalesce(bool_and(j.active), false) AS active,
  count(*) = 1 AND coalesce(bool_and(j.schedule = '*/10 * * * *' AND j.command = 'SELECT cart_quota.purge_expired(10000)'), false) AS correct,
  coalesce(bool_or(EXISTS (SELECT 1 FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.status = 'succeeded' AND d.end_time >= now() - interval '30 minutes')), false) AS succeeded
  FROM cron.job j WHERE j.jobname = 'commerce-cart-quota-expiry'"
start="$(date +%s)"
while :; do
  state="$(query "$sql")" || {
    echo "::error::Could not inspect the cart quota cleanup job." >&2
    exit 1
  }
  if ! jq -e 'type == "array" and length == 1 and .[0].active == true and .[0].correct == true' >/dev/null <<<"$state"; then
    echo "::error::Cart quota cleanup job is missing, inactive or misconfigured." >&2
    exit 1
  fi
  if jq -e '.[0].succeeded == true' >/dev/null <<<"$state"; then
    echo "Cart quota cleanup job has a recent successful run."
    exit 0
  fi
  if [ "$(( $(date +%s) - start ))" -ge "$deadline" ]; then
    echo "::error::No successful cleanup run observed before the deadline." >&2
    exit 1
  fi
  sleep "$interval"
done

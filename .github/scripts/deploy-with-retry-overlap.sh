#!/usr/bin/env bash
# Post-promote overlap exclusion for deploy-with-retry.sh. Sourced, not
# executed: needs deploy_command, promote_first/second/third_command,
# PROMOTE_ATTEMPTS, PROMOTE_TIMEOUT_SECONDS, BACKOFF_SECONDS,
# DEPLOY_PROMOTE_OVERLAP_CHECK, and run_with_timeout from the caller.
# Split to keep deploy-with-retry.sh under the 300-line limit.

# Raw `vercel promote` through the deploy command's own prefix (same
# pinning/auth as the deploy). No guards inside: the pre-promote
# caller checks authority/overlap first, and the overlap rollback
# below must bypass the overlap check (the rolled-back run is, by
# construction, listed in the record that tripped it).
_run_vercel_promote() {
  local promote_target="$1"

  if [ "$promote_first_command" = "pnpm" ] && [ "$promote_second_command" = "exec" ] && [ "$promote_third_command" = "vercel" ]; then
    run_with_timeout "$PROMOTE_TIMEOUT_SECONDS" "${deploy_command[0]}" "${deploy_command[1]}" "${deploy_command[2]}" promote "$promote_target" --yes
  elif [ "$promote_first_command" = "npx" ] && [ "$promote_second_command" = "vercel" ]; then
    run_with_timeout "$PROMOTE_TIMEOUT_SECONDS" "${deploy_command[0]}" "${deploy_command[1]}" promote "$promote_target" --yes
  else
    run_with_timeout "$PROMOTE_TIMEOUT_SECONDS" "${deploy_command[0]}" promote "$promote_target" --yes
  fi
}

# Prints `uid|url` for the deployment currently holding production
# (the rollback target if the post-promote overlap verification
# fails), or nothing when no production deployment exists yet (first
# deploy — the caller warns and proceeds without a net). Returns 1
# when the answer is unknowable: the caller fails the attempt rather
# than staging a deployment it could not roll back. CALL BEFORE THE
# FIRST STAGING: `vercel deploy --prod` creates a staged
# production-target deployment, after which newest-production
# queries return our own candidate. Response shape
# `{"deployments":[{"uid":"dpl_...","url":"...vercel.app",...}]}`
# (newest first); the url half lets the verifier refuse a rollback
# to the just-promoted candidate itself. An explicitly empty array
# means first deploy, anything else unparseable fails closed (an API
# shape change must never read as "no previous"). Residual: an
# orphaned staged candidate from a past failed run (staged but never
# promoted) also reads as newest — only an alias-resolved query
# could exclude those, and its fields are unverified.
capture_previous_production_deployment() {
  local capture_query
  local capture_body
  local capture_code
  local capture_uid
  local capture_url

  if [ -z "${VERCEL_TOKEN:-}" ] || [ -z "${VERCEL_PROJECT_ID:-}" ]; then
    echo "Cannot capture the current production deployment: VERCEL_TOKEN or VERCEL_PROJECT_ID is unset." >&2
    return 1
  fi
  capture_query="projectId=${VERCEL_PROJECT_ID}&target=production&limit=1"
  if [ -n "${VERCEL_ORG_ID:-}" ]; then
    capture_query="${capture_query}&teamId=${VERCEL_ORG_ID}"
  fi
  capture_body="$(mktemp)" || return 1
  capture_code="$(curl -sS -o "$capture_body" -w '%{http_code}' --max-time 30 "https://api.vercel.com/v6/deployments?${capture_query}" -H "Authorization: Bearer ${VERCEL_TOKEN}" 2>/dev/null || true)"
  case "$capture_code" in
    2*) ;;
    *)
      echo "Cannot capture the current production deployment: Vercel API returned HTTP ${capture_code:-curl-failed}." >&2
      rm -f "$capture_body"
      return 1
      ;;
  esac
  capture_uid="$(grep -o '"uid":"dpl_[^"]*"' "$capture_body" 2>/dev/null | head -n 1 | cut -d'"' -f4 || true)"
  if [ -z "$capture_uid" ]; then
    if grep -q '"deployments":[[:space:]]*\[\]' "$capture_body" 2>/dev/null; then
      rm -f "$capture_body"
      return 0
    fi
    echo "Cannot capture the current production deployment: unparseable Vercel API response." >&2
    rm -f "$capture_body"
    return 1
  fi
  capture_url="$(grep -o '"url":"[^"]*"' "$capture_body" 2>/dev/null | head -n 1 | cut -d'"' -f4 || true)"
  rm -f "$capture_body"
  printf '%s|%s\n' "$capture_uid" "$capture_url"
  return 0
}

# Durable half of the overlap exclusion. Runs AFTER a successful
# promote: a worker flip recorded DURING the promote (after the last
# pre-check) publishes off stale latch/SHA reads unless it is rolled
# back now. On overlap, re-promotes the captured previous production
# deployment (retried; the raw promote bypasses the overlap check the
# rolled-back run is listed in) and returns 1. With no previous
# deployment (first deploy), fails loud with a manual-reconcile
# directive instead of an automatic rollback. previous_capture is
# `uid|url` (either half missing still verifies against the other).
verify_post_promote_overlap() {
  local new_target="$1"
  local previous_capture="$2"
  local previous_uid
  local previous_url
  local rollback_attempt
  local rollback_ok

  if "$DEPLOY_PROMOTE_OVERLAP_CHECK"; then
    return 0
  fi
  echo "::error::A worker promote overlapped the production promotion of ${new_target}." >&2
  if [ -z "$previous_capture" ]; then
    echo "::error::No previous production deployment to roll back to; manually reconcile the overlapped publish, then re-run." >&2
    return 1
  fi
  previous_uid="${previous_capture%%|*}"
  previous_url="${previous_capture#*|}"
  # Never restore the just-promoted candidate itself: with correct
  # pre-staging capture timing this is unreachable (our candidates
  # postdate the capture), so reaching it means the timing regressed
  # or the API misled us — fail loud instead of a no-op restore.
  if [ "$previous_uid" = "$new_target" ] || [ "$new_target" = "https://${previous_url}" ]; then
    echo "::error::Refusing overlap rollback: the captured previous deployment IS the just-promoted candidate; manually reconcile, then re-run." >&2
    return 1
  fi
  rollback_ok=0
  rollback_attempt=0
  while [ "$rollback_attempt" -lt "$PROMOTE_ATTEMPTS" ]; do
    rollback_attempt=$((rollback_attempt + 1))
    if _run_vercel_promote "$previous_uid"; then
      rollback_ok=1
      break
    fi
    if [ "$rollback_attempt" -lt "$PROMOTE_ATTEMPTS" ]; then
      sleep "$BACKOFF_SECONDS"
    fi
  done
  if [ "$rollback_ok" = "1" ]; then
    echo "Rolled production back to ${previous_uid} after the overlapped promotion of ${new_target}; re-run the workflow." >&2
  else
    echo "::error::Rollback of ${new_target} to ${previous_uid} failed; manually promote ${previous_uid} in the Vercel dashboard, then re-run." >&2
  fi
  return 1
}

#!/usr/bin/env bash
# Post-promote overlap exclusion for deploy-with-retry.sh. Sourced, not
# executed: needs deploy_command, promote_first/second/third_command,
# PROMOTE_ATTEMPTS, PROMOTE_TIMEOUT_SECONDS, BACKOFF_SECONDS,
# DEPLOY_PROMOTE_OVERLAP_CHECK, and run_with_timeout from the caller.
# Split to keep deploy-with-retry.sh under the 300-line limit.

# Raw `vercel promote` through the deploy command's own prefix (same
# pinning/auth as the deploy). No guards inside: the pre-promote
# caller checks authority/overlap first.
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

# Raw `vercel rollback` through the same prefix. A previously
# promoted production deployment CANNOT be promoted again — Vercel
# requires rollback to restore it — so the overlap recovery below
# must use this, never _run_vercel_promote. No guards inside: the
# rolled-back run is, by construction, listed in the record that
# tripped the recovery, so any overlap pre-check here would refuse
# the very remediation it demands.
_run_vercel_rollback() {
  local rollback_target="$1"

  if [ "$promote_first_command" = "pnpm" ] && [ "$promote_second_command" = "exec" ] && [ "$promote_third_command" = "vercel" ]; then
    run_with_timeout "$PROMOTE_TIMEOUT_SECONDS" "${deploy_command[0]}" "${deploy_command[1]}" "${deploy_command[2]}" rollback "$rollback_target" --yes
  elif [ "$promote_first_command" = "npx" ] && [ "$promote_second_command" = "vercel" ]; then
    run_with_timeout "$PROMOTE_TIMEOUT_SECONDS" "${deploy_command[0]}" "${deploy_command[1]}" rollback "$rollback_target" --yes
  else
    run_with_timeout "$PROMOTE_TIMEOUT_SECONDS" "${deploy_command[0]}" rollback "$rollback_target" --yes
  fi
}

# Prints `uid|url` for the deployment CURRENTLY SERVING production
# (the rollback target if the post-promote overlap verification
# fails). Returns 1 when the answer is unknowable: the caller fails
# the attempt rather than staging a deployment it could not roll
# back. Resolves the production ALIAS (`GET /v4/aliases/{alias}`
# returns the attached deployment's REQUIRED deploymentId field),
# never newest-production: staged candidates — ours (CALL BEFORE THE
# FIRST STAGING) or an orphaned one from a past failed run — also
# carry target=production and would misresolve. The projectId scope
# guards against a mistyped alias resolving into another project
# (404s instead). A 404 fails closed like any other unresolvable
# answer: this workflow deploys an established production alias, so a
# missing alias means deleted/mistyped configuration or a masked
# authorization failure — an unknown rollback target, never a first
# deploy. An API shape change must likewise never read as "no
# previous": anything unparseable fails closed.
capture_previous_production_deployment() {
  local capture_query
  local capture_body
  local capture_code
  local capture_uid
  local capture_url

  if [ -z "${VERCEL_TOKEN:-}" ] || [ -z "${VERCEL_PROJECT_ID:-}" ] || [ -z "${OVERLAP_PRODUCTION_ALIAS:-}" ]; then
    echo "Cannot capture the current production deployment: VERCEL_TOKEN, VERCEL_PROJECT_ID, or OVERLAP_PRODUCTION_ALIAS is unset." >&2
    return 1
  fi
  capture_query="projectId=${VERCEL_PROJECT_ID}"
  if [ -n "${VERCEL_ORG_ID:-}" ]; then
    capture_query="${capture_query}&teamId=${VERCEL_ORG_ID}"
  fi
  capture_body="$(mktemp)" || return 1
  capture_code="$(curl -sS -o "$capture_body" -w '%{http_code}' --max-time 30 "https://api.vercel.com/v4/aliases/${OVERLAP_PRODUCTION_ALIAS}?${capture_query}" -H "Authorization: Bearer ${VERCEL_TOKEN}" 2>/dev/null || true)"
  case "$capture_code" in
    2*) ;;
    404)
      # The configured production alias MUST exist (see header): a
      # 404 is a deleted/mistyped alias or a masked authorization
      # failure, i.e. an unknown rollback target. Abort before
      # staging rather than promoting without recovery: if the
      # post-promote overlap check then tripped, the stale-read
      # candidate would stay serving with only a manual-reconcile
      # error to show for it.
      echo "Cannot capture the current production deployment: the production alias '${OVERLAP_PRODUCTION_ALIAS}' was not found (HTTP 404). Refusing to stage without a rollback target; restore the alias or fix its spelling, then re-run." >&2
      rm -f "$capture_body"
      return 1
      ;;
    *)
      echo "Cannot capture the current production deployment: Vercel API returned HTTP ${capture_code:-curl-failed}." >&2
      rm -f "$capture_body"
      return 1
      ;;
  esac
  capture_uid="$(grep -o '"deploymentId":"dpl_[^"]*"' "$capture_body" 2>/dev/null | head -n 1 | cut -d'"' -f4 || true)"
  if [ -z "$capture_uid" ]; then
    echo "Cannot capture the current production deployment: unparseable Vercel API response." >&2
    rm -f "$capture_body"
    return 1
  fi
  capture_url="$(grep -o '"url":"[^"]*"' "$capture_body" 2>/dev/null | head -n 1 | cut -d'"' -f4 || true)"
  rm -f "$capture_body"
  printf '%s|%s\n' "$capture_uid" "$capture_url"
  return 0
}

# Ambiguous-failure recovery for run_promote_command. A promote that
# took effect server-side while the client timed out or lost the
# response returns nonzero here — but skipping overlap verification
# then strands a stale-read publication with no rollback, because the
# next retry refuses at the pre-check (the record now lists this run)
# while the candidate stays current. Resolve the production alias: if
# OUR candidate is serving, verify exactly as on the success path
# (rolling back on overlap). The alias lookup itself is retried: a
# single transient lookup failure must not discard the ambiguous
# state while the candidate serves. Returns 0 (recovered success)
# only when the candidate is serving AND no overlap is recorded; 1
# otherwise (genuinely failed, unresolvable, or
# overlapped-and-rolled-back). Fail-closed on unknowable: assuming
# effectiveness without proof would report success for a deploy that
# never promoted.
recover_ambiguous_promote() {
  local ambiguous_target="$1"
  local previous_capture="$2"
  local serving_capture
  local serving_uid
  local serving_url
  local serving_attempt

  serving_capture=""
  serving_attempt=0
  while [ "$serving_attempt" -lt 3 ]; do
    serving_attempt=$((serving_attempt + 1))
    if serving_capture="$(capture_previous_production_deployment)"; then
      break
    fi
    serving_capture=""
    if [ "$serving_attempt" -lt 3 ]; then
      sleep "$BACKOFF_SECONDS"
    fi
  done
  if [ -z "$serving_capture" ]; then
    echo "Cannot resolve the serving production deployment after the ambiguous promote of ${ambiguous_target}: the alias lookup failed repeatedly, so the candidate may be serving production without post-promote overlap verification. Manually confirm what is serving (Vercel dashboard or GET /v4/aliases/${OVERLAP_PRODUCTION_ALIAS:-<alias>}); if it is ${ambiguous_target}, roll it back and re-run." >&2
    return 1
  fi
  serving_uid="${serving_capture%%|*}"
  serving_url="${serving_capture#*|}"
  if [ "$serving_uid" != "$ambiguous_target" ] && [ "$ambiguous_target" != "https://${serving_url}" ]; then
    return 1
  fi
  echo "Promote of ${ambiguous_target} failed ambiguously but the candidate is serving production; verifying overlap." >&2
  verify_post_promote_overlap "$ambiguous_target" "$previous_capture"
}

# Durable half of the overlap exclusion. Runs AFTER a successful
# promote: a worker flip recorded DURING the promote (after the last
# pre-check) publishes off stale latch/SHA reads unless it is rolled
# back now. On overlap, re-promotes the captured previous production
# deployment (retried; the raw promote bypasses the overlap check the
# rolled-back run is listed in) and returns 1. With no previous
# deployment captured (defensive: capture now refuses rather than
# returning empty, so this means the capture contract regressed),
# fails loud with a manual-reconcile directive instead of an
# automatic rollback. previous_capture is `uid|url` (either half
# missing still verifies against the other).
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
    if _run_vercel_rollback "$previous_uid"; then
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
    echo "::error::Rollback of ${new_target} to ${previous_uid} failed; manually roll back to ${previous_uid} in the Vercel dashboard, then re-run." >&2
  fi
  return 1
}

# Restore the exact pre-staging production deployment after a post-promote
# runtime preflight failure. Never promote the previous URL: Vercel requires a
# rollback to move aliases back to a deployment that already served production.
rollback_to_captured_production() {
  local failed_target="$1"
  local previous_capture="$2"
  local previous_uid="${previous_capture%%|*}"
  local rollback_attempt=0

  if [ -z "$previous_capture" ] || [ -z "$previous_uid" ] || [ "$previous_uid" = "$failed_target" ]; then
    echo "::error::No distinct captured production deployment is available to restore after ${failed_target}; manual reconciliation is required." >&2
    return 1
  fi
  while [ "$rollback_attempt" -lt "$PROMOTE_ATTEMPTS" ]; do
    rollback_attempt=$((rollback_attempt + 1))
    if _run_vercel_rollback "$previous_uid"; then
      local verification_attempt=0
      local current_capture=""
      while [ "$verification_attempt" -lt 3 ]; do
        verification_attempt=$((verification_attempt + 1))
        current_capture="$(capture_previous_production_deployment 2>/dev/null || true)"
        if [ "${current_capture%%|*}" = "$previous_uid" ]; then
          echo "Rolled production back to ${previous_uid} after runtime preflight failure of ${failed_target}; alias verified." >&2
          return 0
        fi
        if [ "$verification_attempt" -lt 3 ]; then sleep "$BACKOFF_SECONDS"; fi
      done
      echo "::error::Rollback command for ${failed_target} returned success, but production alias verification did not confirm ${previous_uid}; manually reconcile Vercel and retain the release lock." >&2
      return 1
    fi
    if [ "$rollback_attempt" -lt "$PROMOTE_ATTEMPTS" ]; then
      sleep "$BACKOFF_SECONDS"
    fi
  done
  echo "::error::Rollback of ${failed_target} to ${previous_uid} failed; manually restore ${previous_uid} in Vercel and reconcile the release lock." >&2
  return 1
}

verify_promoted_candidate_serving() {
  local candidate="$1"
  local attempt=0
  local serving_capture=""
  local serving_uid=""
  local serving_url=""
  while [ "$attempt" -lt 3 ]; do
    attempt=$((attempt + 1))
    serving_capture="$(capture_previous_production_deployment 2>/dev/null || true)"
    serving_uid="${serving_capture%%|*}"
    serving_url="${serving_capture#*|}"
    if [ "$candidate" = "$serving_uid" ] || [ "$candidate" = "$serving_url" ] || [ "$candidate" = "https://${serving_url}" ]; then
      return 0
    fi
    if [ "$attempt" -lt 3 ]; then sleep "$BACKOFF_SECONDS"; fi
  done
  echo "::error::Production alias did not resolve to promoted candidate ${candidate}; runtime preflight is withheld." >&2
  return 1
}

verify_post_promote_runtime() {
  local new_target="$1"
  local previous_capture="$2"
  if [ -z "${DEPLOY_POST_PROMOTE_HEALTH_CHECK:-}" ]; then
    return 0
  fi
  if ! verify_promoted_candidate_serving "$new_target"; then
    echo "::error::Restoring captured production because the alias does not identify the candidate." >&2
    rollback_to_captured_production "$new_target" "$previous_capture" || return 1
    return 1
  fi
  if "$DEPLOY_POST_PROMOTE_HEALTH_CHECK"; then
    return 0
  fi
  echo "::error::The promoted deployment ${new_target} failed its authenticated runtime preflight; restoring captured production." >&2
  rollback_to_captured_production "$new_target" "$previous_capture" || return 1
  # A confirmed rollback restores safety, but the publishing run remains a
  # failed run and must not retry/re-promote this candidate.
  return 1
}

validate_post_promote_health_configuration() {
  if [ -n "$DEPLOY_POST_PROMOTE_HEALTH_CHECK" ] && [ -z "$DEPLOY_PROMOTE_OVERLAP_CHECK" ]; then
    echo "DEPLOY_POST_PROMOTE_HEALTH_CHECK requires DEPLOY_PROMOTE_OVERLAP_CHECK to capture a rollback target." >&2
    return 1
  fi
}

verify_post_promote_runtime_with_fatal_flag() {
  if ! verify_post_promote_runtime "$1" "$2"; then
    fatal_promote_failure=1
    return 1
  fi
}

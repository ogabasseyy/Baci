#!/usr/bin/env bash
# IMPORTANT: --archive=tgz is required to prevent Vercel upload rate limiting.
# Do NOT remove it — without it, each deploy uploads thousands of individual files.
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 <command> [args...]"
  exit 1
fi

# Two attempts fit the deploy step's timeout-minutes budget in deploy.yml: one
# capped deploy (~20m) that recovers by promoting its created deployment (or, if
# unpromotable, falls through) plus one fallback deploy (~20m). A third attempt
# could not finish before the step deadline, so it would only create another
# unpromoted deployment -- don't start one.
MAX_ATTEMPTS=${MAX_ATTEMPTS:-2}
BACKOFF_SECONDS=${BACKOFF_SECONDS:-15}
# Per-attempt wall-clock cap for the deploy command. Vercel CLI 57's
# `vercel deploy --prebuilt --prod` has been observed to create the deployment
# (READY + URL printed) and then hang without exiting, tying up the self-hosted
# runner for the whole job and holding the deploy concurrency lock. Cap each
# attempt so a hung deploy is terminated and its created deployment promoted.
# Set to 0 to disable the cap.
DEPLOY_ATTEMPT_TIMEOUT_SECONDS=${DEPLOY_ATTEMPT_TIMEOUT_SECONDS:-1200}
# Cap for promote-shaped commands so a hung `vercel promote` (or the
# overlap `vercel rollback`, which reuses this budget) cannot run forever.
PROMOTE_TIMEOUT_SECONDS=${PROMOTE_TIMEOUT_SECONDS:-120}
# How many times to (re)try promoting a captured deployment before giving up on
# it. Retrying the SAME target absorbs a transient promote failure (network blip
# or the promote timeout) without starting a fresh deploy (which would create a
# duplicate deployment). Kept small so the recovery budget -- one capped deploy
# (DEPLOY_ATTEMPT_TIMEOUT_SECONDS) plus these promote retries -- still leaves a
# fallback deploy attempt room to finish inside the deploy step's timeout-minutes
# in deploy.yml (~20m + ~5m + ~20m < 55m).
PROMOTE_ATTEMPTS=${PROMOTE_ATTEMPTS:-2}
# Optional exact-main authority check. The production workflow binds this to a
# fail-closed GitHub ref verifier. Tests and non-production callers may omit it.
DEPLOY_CURRENT_MAIN_GUARD=${DEPLOY_CURRENT_MAIN_GUARD:-}
# Optional worker-promote overlap check. The production workflow binds this
# to the publish-side overlap refusal: the pre-publish step is only a
# point-in-time check before a deployment step that may run ~55 minutes,
# and a promote recorded after that step would otherwise publish off a
# stale latch/SHA read. Checked immediately before EVERY promote attempt
# (a record written during the deploy, a backoff, or an earlier attempt
# blocks the promotion) AND immediately after (a record written during
# the promote itself rolls the publish back to the captured previous
# production deployment). Tests and non-production callers may omit it.
DEPLOY_PROMOTE_OVERLAP_CHECK=${DEPLOY_PROMOTE_OVERLAP_CHECK:-}
deploy_command=("$@")
# The deploy command prefix is static per process: resolve it once for
# the promote/rollback command-shape dispatch in the overlap helper.
promote_first_command="$(basename "${deploy_command[0]}")"
promote_second_command="${deploy_command[1]:-}"
promote_third_command="${deploy_command[2]:-}"
last_deployment_target=""
# Post-promote overlap exclusion (capture + verify + rollback): split
# to keep this file under the 300-line limit.
retry_lib_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=deploy-with-retry-overlap.sh
. "$retry_lib_dir/deploy-with-retry-overlap.sh"
# Rollback target for the post-promote overlap exclusion: captured
# ONCE before the first staging (see the attempt loop) and reused by
# every promote in this process.
captured_previous_production_target=""
previous_production_captured=0

run_current_main_guard() {
  if [ -z "$DEPLOY_CURRENT_MAIN_GUARD" ]; then
    return 0
  fi
  "$DEPLOY_CURRENT_MAIN_GUARD"
}

# Run "$@" under a wall-clock cap. `timeout` is coreutils (present on the Linux
# deploy runners); `gtimeout` is its Homebrew name on macOS. Where neither
# exists, run without a cap so the script and its tests stay portable.
run_with_timeout() {
  local seconds="$1"
  shift

  if [ "$seconds" -gt 0 ]; then
    if command -v timeout >/dev/null 2>&1; then
      timeout -k 30 "$seconds" "$@"
      return
    fi
    if command -v gtimeout >/dev/null 2>&1; then
      gtimeout -k 30 "$seconds" "$@"
      return
    fi
  fi

  "$@"
}

is_duplicate_custom_deployment_id_error() {
  local log_file="$1"

  grep -Eiq \
    '((custom[[:space:]-]+)?deployment[[:space:]-]+id|NEXT_DEPLOYMENT_ID|deploymentId).*(already|duplicate|exists|used)' \
    "$log_file"
}

extract_deployment_target() {
  local log_file="$1"

  grep -Eo '(https://[^[:space:]]+\.vercel\.app|dpl_[A-Za-z0-9_-]+)' "$log_file" \
    | sed 's/[),.;]*$//' \
    | tail -n 1
}

remember_deployment_target() {
  local log_file="$1"
  local deployment_target

  deployment_target="$(extract_deployment_target "$log_file" || true)"
  if [ -n "$deployment_target" ]; then
    last_deployment_target="$deployment_target"
  fi
}

run_promote_command() {
  local overlap_bound

  if ! run_current_main_guard; then
    echo "The current-main deployment guard refused to promote ${last_deployment_target}." >&2
    return 1
  fi

  overlap_bound=0
  if [ -n "$DEPLOY_PROMOTE_OVERLAP_CHECK" ]; then
    overlap_bound=1
    if ! "$DEPLOY_PROMOTE_OVERLAP_CHECK"; then
      echo "The worker-promote overlap check refused to promote ${last_deployment_target}." >&2
      return 1
    fi
  fi

  if ! _run_vercel_promote "$last_deployment_target"; then
    # Ambiguous failure (server-side effect with a client-side error):
    # resolve the alias and verify/roll back before returning.
    if [ "$overlap_bound" = "1" ] && recover_ambiguous_promote "$last_deployment_target" "$captured_previous_production_target"; then
      return 0
    fi
    return 1
  fi

  # Durable half of the exclusion (helper): a promote recorded DURING
  # the promote above rolls back to the pre-staging capture here.
  # Retries re-enter above and refuse at the pre-check (the record
  # now lists this run), so the rollback runs exactly once.
  if [ "$overlap_bound" = "1" ]; then
    if ! verify_post_promote_overlap "$last_deployment_target" "$captured_previous_production_target"; then
      return 1
    fi
  fi
  return 0
}

# Promote last_deployment_target, retrying a transient promote failure before
# giving up. Retrying the SAME target matters: giving up here would start
# another deploy and create a brand-new deployment. Returns 0 once promoted,
# 1 if every attempt failed (the target is genuinely unpromotable).
promote_with_retries() {
  local promote_attempt
  for promote_attempt in $(seq 1 "$PROMOTE_ATTEMPTS"); do
    if run_promote_command; then
      return 0
    fi
    if [ "$promote_attempt" -lt "$PROMOTE_ATTEMPTS" ]; then
      echo "Promote of ${last_deployment_target} failed (promote attempt ${promote_attempt}/${PROMOTE_ATTEMPTS}); retrying in ${BACKOFF_SECONDS}s..." >&2
      sleep "$BACKOFF_SECONDS"
    fi
  done
  return 1
}

promote_existing_deployment() {
  if [ -z "$last_deployment_target" ]; then
    echo "Duplicate deployment ID reported, but no deployment URL or ID was observed; refusing to treat retry as success." >&2
    return 1
  fi

  echo "Deploy already exists for this custom deployment ID; promoting existing deployment ${last_deployment_target}."
  if ! promote_with_retries; then
    echo "Failed to promote existing deployment ${last_deployment_target}; refusing to treat retry as success." >&2
    return 1
  fi
  echo "Promoted existing deployment for this custom deployment ID; treating retry as recovered success."
}

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  if run_current_main_guard; then
    :
  else
    guard_status=$?
    echo "The current-main deployment guard refused deploy attempt ${attempt}; no production deployment was started." >&2
    exit "$guard_status"
  fi
  echo "Deploy attempt $attempt/$MAX_ATTEMPTS..."
  # Capture the rollback target BEFORE the first staging: `vercel
  # deploy --prod` creates a staged production-target deployment,
  # after which newest-production queries return our own candidate
  # instead of the deployment serving production. Once per process:
  # later attempts reuse it (their own staged candidates would
  # pollute a fresh read). A failed capture fails the attempt
  # WITHOUT staging anything, so the retry re-captures cleanly.
  if [ -n "$DEPLOY_PROMOTE_OVERLAP_CHECK" ] && [ "$previous_production_captured" = "0" ]; then
    if ! captured_previous_production_target="$(capture_previous_production_deployment)"; then
      echo "The worker-promote overlap check refused deploy attempt ${attempt}: no rollback target could be captured." >&2
      if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
        sleep "$BACKOFF_SECONDS"
      fi
      continue
    fi
    previous_production_captured=1
    if [ -z "$captured_previous_production_target" ]; then
      echo "WARNING: no previous production deployment found; overlap rollbacks in this run will fail loud instead." >&2
    fi
  fi
  attempt_log="$(mktemp)"

  set +e
  run_with_timeout "$DEPLOY_ATTEMPT_TIMEOUT_SECONDS" "${deploy_command[@]}" 2>&1 | tee "$attempt_log"
  status=${PIPESTATUS[0]}
  set -e

  # `timeout` exits 124 (killed with TERM) or 137 (128+9, killed with KILL -- the
  # `-k` grace escalating against a TERM-resistant hang, or an unrelated OOM /
  # external kill). CLI 57 creates the deployment (READY, URL printed) then hangs,
  # and a `vercel deploy --prebuilt` RETRY just makes a brand-new deployment (no
  # duplicate-id error), so recover by promoting the deployment this attempt
  # created. promote_with_retries absorbs a transient promote failure on the SAME
  # target; only if promotion still fails (an unrelated kill left no promotable
  # deployment) do we fall through to a fresh deploy so those failures keep their
  # remaining attempts (status alone cannot tell a `-k` escalation from a child
  # SIGKILL).
  if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
    echo "Deploy attempt $attempt was killed (status $status: timed out or signalled)." >&2
    timed_out_target="$(extract_deployment_target "$attempt_log" || true)"
    if [ -n "$timed_out_target" ]; then
      last_deployment_target="$timed_out_target"
      echo "Promoting the deployment it created: ${last_deployment_target}..."
      if promote_with_retries; then
        echo "Recovered killed deploy by promoting ${last_deployment_target} to production."
        rm -f "$attempt_log"
        exit 0
      fi
      echo "Could not promote ${last_deployment_target} after ${PROMOTE_ATTEMPTS} attempts; treating as a normal failure." >&2
    fi
    # No promotable deployment -- fall through to the duplicate-id check / retry.
  fi

  if [ "$status" -eq 0 ]; then
    echo "Deploy succeeded on attempt $attempt"
    # Vercel stopped auto-assigning the production domains to `--prod` deploys
    # (observed 2026-07-23): the deploy now lands as production but the domains
    # stay on the previous deployment until it is promoted. Promote the
    # just-created deployment so the production domains follow every deploy
    # instead of silently freezing. Idempotent if Vercel restores auto-assign.
    # Extract the target from THIS successful attempt only -- never fall back to
    # a URL retained from an earlier failed attempt (remember_deployment_target
    # keeps prior state), which would promote the wrong deployment when a retry
    # succeeds without re-emitting a parseable target.
    last_deployment_target="$(extract_deployment_target "$attempt_log" || true)"
    rm -f "$attempt_log"
    if [ -z "$last_deployment_target" ]; then
      echo "Deploy succeeded but no deployment URL/ID was observed to promote." >&2
      exit 1
    fi
    echo "Promoting deployment ${last_deployment_target} to production..."
    if ! promote_with_retries; then
      echo "Deploy succeeded but promote failed for ${last_deployment_target}." >&2
      exit 1
    fi
    echo "Promoted ${last_deployment_target} to production."
    exit 0
  fi

  remember_deployment_target "$attempt_log"

  if is_duplicate_custom_deployment_id_error "$attempt_log"; then
    if promote_existing_deployment; then
      rm -f "$attempt_log"
      exit 0
    fi
  fi

  rm -f "$attempt_log"

  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    echo "Deploy failed, retrying in ${BACKOFF_SECONDS}s..."
    sleep "$BACKOFF_SECONDS"
  fi
done

echo "Deploy failed after $MAX_ATTEMPTS attempts"
exit 1

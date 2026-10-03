#!/usr/bin/env bash
# Refuses worker promotion while a production deploy workflow run is still
# in flight. Sourced by deploy.sh; call check_deploy_workflow_inflight
# before promoting.
#
# The deploy workflow reads the cutover latch and installed SHA early
# (vps-drain-readiness), then runs migrations and a build that can take
# hours before publishing. Promotion replaces app-checkout.sha while
# deliberately preserving the latch, so a manual promote landing in that
# window publishes off stale outputs — worst case the Vercel cron
# removal lands while an exit-42-deferred poller cannot reach its
# schema. The publish job runs on a GitHub-hosted runner with no VPS
# reachability, so the workflow cannot re-read the files itself; the
# serialization has to live on the promote side.
check_deploy_workflow_inflight() {
  if [ "${BACI_DEPLOY_SKIP_INFLIGHT_CHECK:-}" = "1" ]; then
    echo "WARNING: skipping the in-flight deploy-workflow check (BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1). Re-run the GIGL smoke/latch sequence after this promote and confirm no production deploy published off the pre-promote latch/SHA." >&2
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "Refusing worker promotion: the gh CLI is not installed, so in-flight production deploys cannot be ruled out. Install and authenticate gh, or (emergency only) rerun with BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1 and re-verify the latch afterwards." >&2
    exit 1
  fi
  # Resolve the repo explicitly from origin: gh's default resolution
  # follows the checkout's remotes, so a fork-clone deploy would query
  # the fork (no runs) and pass vacuously while production deploys fly.
  inflight_repo=""
  inflight_remote="$(git remote get-url origin 2>/dev/null || true)"
  case "$inflight_remote" in
    https://github.com/* | http://github.com/* | git@github.com:* | ssh://git@github.com/*)
      inflight_repo="${inflight_remote%.git}"
      inflight_repo="${inflight_repo##*github.com[:/]}"
      case "$inflight_repo" in
        */*) ;;
        *) inflight_repo="" ;;
      esac
      ;;
  esac
  # Declare the optional args only when non-empty: expanding an empty
  # array under `set -u` fails on bash 3.2 (macOS /bin/bash), while the
  # `${name[@]+...}` guard below handles the unset case portably.
  if [ -n "$inflight_repo" ]; then
    inflight_repo_args=(-R "$inflight_repo")
  fi
  # Only main-branch runs can publish (deploy-production requires
  # github.ref == refs/heads/main), but ANY non-completed status counts:
  # queued and waiting runs (the production environment can hold a run
  # on approval) publish later off the same early latch/SHA read.
  inflight_err="$(mktemp 2>/dev/null)" || inflight_err=""
  # shellcheck disable=SC2086 # The ${name[@]+...} guard intentionally expands to zero words when unset.
  if ! inflight_runs="$(gh run list ${inflight_repo_args[@]+"${inflight_repo_args[@]}"} --workflow deploy.yml --branch main --limit 50 \
    --json databaseId,status,headSha,event,url \
    --jq 'map(select(.status != "completed")) | .[] | "\(.databaseId) \(.status) \((.headSha // "?")[0:8]) \(.event // "?") \(.url)"' \
    2>"${inflight_err:-/dev/null}")"; then
    inflight_detail=""
    if [ -n "$inflight_err" ]; then
      inflight_detail="$(head -c 500 "$inflight_err" 2>/dev/null || true)"
      rm -f "$inflight_err"
    fi
    echo "Refusing worker promotion: could not list production deploy runs${inflight_detail:+: $inflight_detail}. Authenticate gh (gh auth login), or (emergency only) rerun with BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1 and re-verify the latch afterwards." >&2
    exit 1
  fi
  if [ -n "$inflight_err" ]; then rm -f "$inflight_err"; fi
  if [ -n "$inflight_runs" ]; then
    echo "Refusing worker promotion: production deploy run(s) still in flight (they publish off the pre-promote latch/SHA):" >&2
    echo "$inflight_runs" >&2
    echo "Wait for the workflow to finish, then rerun deploy.sh. Emergency override: BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1 (then re-run the GIGL smoke/latch sequence before relying on the poller)." >&2
    exit 1
  fi
}

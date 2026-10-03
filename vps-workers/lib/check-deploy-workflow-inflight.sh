#!/usr/bin/env bash
# Serializes manual worker promotion with the production deploy
# workflow. Sourced by deploy.sh.
#
# The deploy workflow reads the cutover latch and installed SHA early
# (vps-drain-readiness), then runs migrations and a build that can take
# hours before publishing. Promotion replaces app-checkout.sha while
# deliberately preserving the latch, so a manual promote landing in that
# window publishes off stale outputs — worst case the Vercel cron
# removal lands while an exit-42-deferred poller cannot reach its
# schema. The publish job runs on a GitHub-hosted runner with no VPS
# reachability, so the workflow cannot re-read the files itself; the
# serialization crosses the GitHub API in both directions:
#
# - check_deploy_workflow_inflight (before staging for fail-fast, and
#   again immediately before promote): refuses when any main-branch
#   deploy run is still in flight.
# - record_deploy_workflow_promote (immediately after promote): records
#   the promoted SHA plus the runs in flight during the promote in the
#   GIGL_WORKER_PROMOTE_RECORD repo variable. The workflow's
#   pre-publish step refuses to publish when its own run id is in that
#   record — true mutual exclusion even for runs that were invisible
#   to the pre-promote query. Run ids, not timestamps: no clocks, no
#   TTL, no stale state — a record only ever matches live runs.

_inflight_owner=""
_inflight_repo=""

_is_valid_repo_slug() {
  # Exactly one slash, non-empty owner and repo. Two case stages: the
  # first rejects empties and extras, the second requires the slash
  # (a lone `*` fallback would accept a slash-less value and split it
  # into owner=repo=itself).
  case "$1" in
    */*/* | /* | */ | "") return 1 ;;
  esac
  case "$1" in
    */*) return 0 ;;
    *) return 1 ;;
  esac
}

_set_inflight_repo() {
  # Resolve the repo explicitly: gh's default resolution follows the
  # checkout's remotes, so a fork-clone deploy would query the fork
  # (no runs) and pass vacuously while production deploys fly. Fail
  # closed when origin is missing or unrecognized; the override covers
  # exotic-but-correct setups (non-github or wrapped remotes).
  if [ -n "${BACI_DEPLOY_WORKFLOW_REPO:-}" ]; then
    if ! _is_valid_repo_slug "$BACI_DEPLOY_WORKFLOW_REPO"; then
      echo "Refusing worker promotion: BACI_DEPLOY_WORKFLOW_REPO must be 'owner/repo', got '$BACI_DEPLOY_WORKFLOW_REPO'." >&2
      exit 1
    fi
    _inflight_owner="${BACI_DEPLOY_WORKFLOW_REPO%%/*}"
    _inflight_repo="${BACI_DEPLOY_WORKFLOW_REPO#*/}"
    return 0
  fi
  inflight_remote="$(git remote get-url origin 2>/dev/null || true)"
  inflight_repo=""
  case "$inflight_remote" in
    https://github.com/* | http://github.com/* | git@github.com:* | ssh://git@github.com/*)
      inflight_repo="${inflight_remote%.git}"
      inflight_repo="${inflight_repo##*github.com[:/]}"
      ;;
  esac
  if ! _is_valid_repo_slug "$inflight_repo"; then
    echo "Refusing worker promotion: cannot resolve the deploy repo from origin '$inflight_remote'. Run from a clean clone of the production repo, or set BACI_DEPLOY_WORKFLOW_REPO=owner/repo." >&2
    exit 1
  fi
  _inflight_owner="${inflight_repo%%/*}"
  _inflight_repo="${inflight_repo#*/}"
}

check_deploy_workflow_inflight() {
  if [ "${BACI_DEPLOY_SKIP_INFLIGHT_CHECK:-}" = "1" ]; then
    echo "WARNING: skipping the pre-promote in-flight deploy check (BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1). The promote is still recorded for the workflow pre-publish overlap check when gh works; re-run the GIGL smoke/latch sequence after this promote and confirm no production deploy published off the pre-promote latch/SHA." >&2
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "Refusing worker promotion: the gh CLI is not installed, so in-flight production deploys cannot be ruled out. Install and authenticate gh, or (emergency only) rerun with BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1 and re-verify the latch afterwards." >&2
    exit 1
  fi
  _set_inflight_repo
  # Only main-branch runs can publish (deploy-production requires
  # github.ref == refs/heads/main), but ANY non-completed status counts:
  # queued and waiting runs (the production environment can hold a run
  # on approval) publish later off the same early latch/SHA read.
  inflight_err="$(mktemp 2>/dev/null)" || inflight_err=""
  if ! inflight_runs="$(gh run list -R "$_inflight_owner/$_inflight_repo" --workflow deploy.yml --branch main --limit 50 \
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

record_deploy_workflow_promote() {
  record_sha="${1:?promoted SHA is required}"
  if [[ ! "$record_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Refusing to record worker promotion: expected a 40-hex SHA, got '$record_sha'." >&2
    exit 1
  fi
  # Under the emergency bypass the pre-promote refusal is skipped but
  # the record is still attempted: a recorded overlap blocks the
  # affected runs at publish time, which is strictly safer than a
  # silent promote. Only a broken gh falls back to warn-and-continue
  # there (documented hole; the bypass message mandates re-verify).
  record_strict=1
  if [ "${BACI_DEPLOY_SKIP_INFLIGHT_CHECK:-}" = "1" ]; then
    record_strict=0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    if [ "$record_strict" = "1" ]; then
      echo "Worker promotion is NOT recorded: the gh CLI is not installed, so overlapping workflow runs cannot be warned. Install gh and re-run record_deploy_workflow_promote '$record_sha' from this checkout, then confirm no production deploy published off the pre-promote latch/SHA." >&2
      exit 1
    fi
    echo "WARNING: worker promotion is NOT recorded (no gh CLI under BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1). Manually confirm no production deploy published off the pre-promote latch/SHA." >&2
    return 0
  fi
  _set_inflight_repo
  # List AFTER promote: runs that appeared during the promote read
  # torn (fail-closed marker mismatch) or fresh post-promote state,
  # but recording them is what lets their own pre-publish step prove
  # that instead of trusting this comment.
  record_err="$(mktemp 2>/dev/null)" || record_err=""
  if ! record_runs="$(gh run list -R "$_inflight_owner/$_inflight_repo" --workflow deploy.yml --branch main --limit 50 \
    --json databaseId,status \
    --jq 'map(select(.status != "completed") | .databaseId | tostring) | join(",")' \
    2>"${record_err:-/dev/null}")"; then
    record_detail=""
    if [ -n "$record_err" ]; then
      record_detail="$(head -c 500 "$record_err" 2>/dev/null || true)"
      rm -f "$record_err"
    fi
    if [ "$record_strict" = "1" ]; then
      echo "Worker promotion is NOT recorded: could not list workflow runs${record_detail:+: $record_detail}. The promote already landed; re-run record_deploy_workflow_promote '$record_sha' once gh works, then confirm no production deploy published off the pre-promote latch/SHA." >&2
      exit 1
    fi
    echo "WARNING: worker promotion is NOT recorded (run list failed under BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1${record_detail:+: $record_detail}). Manually confirm no production deploy published off the pre-promote latch/SHA." >&2
    return 0
  fi
  if [ -n "$record_err" ]; then rm -f "$record_err"; fi
  record_value="$record_sha:$record_runs"
  record_path="repos/$_inflight_owner/$_inflight_repo/actions/variables/GIGL_WORKER_PROMOTE_RECORD"
  # Update, creating the variable on first promote (PATCH answers 404
  # when it does not exist yet). Any other write failure fails loud:
  # the promote landed, so silence would leave overlapping runs
  # publishable off stale reads.
  if gh api -X PATCH "$record_path" -f value="$record_value" >/dev/null 2>&1; then
    echo "Recorded worker promote $record_sha ($([ -n "$record_runs" ] && echo "overlapping runs: $record_runs" || echo "no overlapping runs"))."
    return 0
  fi
  if gh api "$record_path" -f name="GIGL_WORKER_PROMOTE_RECORD" -f value="$record_value" >/dev/null 2>&1; then
    echo "Recorded worker promote $record_sha ($([ -n "$record_runs" ] && echo "overlapping runs: $record_runs" || echo "no overlapping runs"))."
    return 0
  fi
  if [ "$record_strict" = "1" ]; then
    echo "Worker promotion is NOT recorded: could not write GIGL_WORKER_PROMOTE_RECORD. The promote already landed; re-run record_deploy_workflow_promote '$record_sha' once gh works, then confirm no production deploy published off the pre-promote latch/SHA." >&2
    exit 1
  fi
  echo "WARNING: worker promotion is NOT recorded (variable write failed under BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1). Manually confirm no production deploy published off the pre-promote latch/SHA." >&2
  return 0
}

#!/usr/bin/env bash
# Serializes manual worker promotion with the production deploy
# workflow. Sourced by deploy.sh.
# No dirname: sourcing must work on a minimal PATH (callers use absolute paths).
_inflight_lib_dir="${BASH_SOURCE[0]:-$0}"
_inflight_lib_dir="${_inflight_lib_dir%/*}"
# shellcheck source=promote-barrier.sh
. "$_inflight_lib_dir/promote-barrier.sh"
# shellcheck source=inflight-repo.sh
. "$_inflight_lib_dir/inflight-repo.sh"
#
# Every function here RETURNS its status and never exits: deploy.sh
# must complete the post-promote installation even when the promote
# record fails (capturing the status and failing at the end), and an
# exit inside a sourced function would kill the caller before it can.
# deploy.sh relies on set -e for the pre-promote refusal and on an
# explicit capture for the record; runbook one-liners propagate via
# &&. Never add an exit to these functions.
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
#   again after the image build, before the cron transition mutates
#   live schedule): refuses when any main-branch deploy run is still
#   in flight.
# - record_deploy_workflow_promote (THREE writes: immediately before
#   the flip as a fail-closed gate, immediately after as a refresh,
#   and after an auto-rollback as a restore record): records the
#   promoted SHA plus the runs in flight at record time in the ops
#   branch (ops/gigl-promote-record), plus a per-deploy barrier file
#   (barriers/<sha>-<host>-<pid>) raised pre-flip and cleared
#   post-flip/restore. The workflow's pre-publish step reads that
#   branch live and refuses when its own run id is recorded OR any
#   barrier file exists — true mutual exclusion even for runs
#   invisible to the pre-promote query and during a stalled refresh
#   (ID lists alone cannot see runs that start mid-stall). The
#   pre-flip write is the fail-closed half: a broken record path
#   refuses the promote before anything is mutated. If the post-flip
#   refresh fails, deploy.sh rolls back and records the restore
#   window. Run ids, not timestamps: no clocks, no TTL. The store is
#   a branch (not an Actions variable) because GITHUB_TOKEN cannot be
#   granted the Variables permission.

_inflight_owner=""
_inflight_repo=""

PROMOTE_RECORD_BRANCH="ops/gigl-promote-record"
PROMOTE_RECORD_FILE=".gigl-promote-record"
_inflight_gh_bin=""

_resolve_inflight_gh() {
  trusted_node="$(PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' command -v node)" || return 1
  _inflight_gh_bin="$("$trusted_node" "$_inflight_lib_dir/../../.github/scripts/trusted-gh.mjs")" || return 1
  [ -n "$_inflight_gh_bin" ]
}

_inflight_gh() {
  [ -n "$_inflight_gh_bin" ] || return 1
  "$_inflight_gh_bin" "$@"
}

_query_release_lock_status() {
  status_helper='/usr/local/lib/baci-worker-broker/production_release_lock_status.py'
  [ -x "$status_helper" ] || return 1
  /usr/bin/python3 "$status_helper" query
}

# Lists every non-completed main-branch deploy.yml run as TSV (id,
# status, short-sha, event, url) with NO fixed recent-run window: a
# `gh run list --limit N` filter applies AFTER the limit, hiding
# approval-held runs older than N newer ones from both the refusal
# and the record. The Actions API filters each non-completed status
# server-side (~zero rows); --paginate covers deep backlogs. Two
# consecutive passes must agree (capped at three) so a mid-scan
# transition cannot dodge both reads; passes union in (fail-safe).
# Usage: _list_noncompleted_workflow_runs <workflow-path> <err-file-or-empty>.
_list_noncompleted_workflow_runs() {
  case "$1" in deploy.yml|production-release.yml) ;; *) return 1 ;; esac
  local _list_workflow="$1"
  local _list_err_file="$2"
  local _list_pass _list_status _list_page
  local _list_pass_tsv _list_pass_ids _list_prev_ids _list_acc
  _list_acc=""
  _list_prev_ids="unseen"
  _list_pass=1
  while [ "$_list_pass" -le 3 ]; do
    _list_pass_tsv=""
    for _list_status in queued in_progress waiting requested pending action_required; do
      if ! _list_page="$(_inflight_gh api "repos/$_inflight_owner/$_inflight_repo/actions/workflows/$_list_workflow/runs?branch=main&status=$_list_status&per_page=100" --paginate \
        --jq '.workflow_runs[] | select(.status != "completed" or .conclusion == "action_required") | "\(.id)\t\(.status)\t\((.head_sha // "?")[0:8])\t\(.event // "?")\t\(.html_url)"' \
        2>"${_list_err_file:-/dev/null}")"; then
        return 1
      fi
      if [ -n "$_list_page" ]; then
        _list_pass_tsv="${_list_pass_tsv}${_list_page}
"
      fi
    done
    _list_acc="${_list_acc}${_list_pass_tsv}"
    if [ -n "$_list_pass_tsv" ]; then
      _list_pass_ids="$(printf '%s' "$_list_pass_tsv" | cut -f1 | sort -n -u | tr '\n' ' ')"
    else
      _list_pass_ids=""
    fi
    if [ "$_list_pass_ids" = "$_list_prev_ids" ]; then
      break
    fi
    _list_prev_ids="$_list_pass_ids"
    _list_pass=$((_list_pass + 1))
  done
  if [ -n "$_list_acc" ]; then
    printf '%s' "$_list_acc" | awk -F'\t' 'NF && !seen[$1]++'
  fi
}

_list_noncompleted_deploy_runs() {
  _list_noncompleted_workflow_runs deploy.yml "$1"
}

check_deploy_workflow_inflight() {
  _set_inflight_repo || return 1
  if ! _resolve_inflight_gh; then
    echo "Refusing worker promotion: the pinned GitHub CLI is missing or has an untrusted owner or mode." >&2
    return 1
  fi
  trusted_node="$(PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' command -v node)" || {
    echo "Refusing worker promotion: a trusted Node.js executable is unavailable for lock authorization." >&2
    return 1
  }
  if ! lock_status="$(_query_release_lock_status 2>/dev/null)"; then
    echo "Refusing worker promotion: the read-only production release lock status endpoint is unavailable; lock absence is unverified." >&2
    return 1
  fi
  case "$lock_status" in
    unlocked) ;;
    locked)
    if ! lock_auth="$("$trusted_node" "$_inflight_lib_dir/../../.github/scripts/production-release-lock.mjs" authorize-worker-lock 2>/dev/null)"; then
      echo "Refusing worker promotion: a persistent production release lock exists and this is not its signed coordinator worker job." >&2
      return 1
    fi
      ;;
    *)
      echo "Refusing worker promotion: the production release lock status response is invalid." >&2
      return 1
      ;;
  esac
  # Only main-branch runs can publish (deploy-production requires
  # github.ref == refs/heads/main), but ANY non-completed status counts:
  # queued and waiting runs (the production environment can hold a run
  # on approval) publish later off the same early latch/SHA read.
  inflight_err="$(mktemp 2>/dev/null)" || inflight_err=""
  if ! inflight_runs="$(_list_noncompleted_deploy_runs "$inflight_err")"; then
    inflight_detail=""
    if [ -n "$inflight_err" ]; then
      inflight_detail="$(head -c 500 "$inflight_err" 2>/dev/null || true)"
      rm -f "$inflight_err"
    fi
    echo "Refusing worker promotion: could not list production deploy runs${inflight_detail:+: $inflight_detail}. Authenticate gh (gh auth login) before retrying." >&2
    return 1
  fi
  if [ -n "$inflight_err" ]; then rm -f "$inflight_err"; fi
  if [ -n "$inflight_runs" ]; then
    echo "Refusing worker promotion: production deploy run(s) still in flight (they publish off the pre-promote latch/SHA):" >&2
    echo "$inflight_runs" >&2
    echo "Wait for the workflow to finish, then rerun deploy.sh." >&2
    return 1
  fi
  if ! coordinator_runs="$(_list_noncompleted_workflow_runs production-release.yml "${inflight_err:-/dev/null}")"; then
    echo "Refusing worker promotion: could not list active production coordinators." >&2
    return 1
  fi
  if [ -n "$inflight_err" ]; then rm -f "$inflight_err"; fi
  if [ -n "$coordinator_runs" ]; then
    coordinator_auth="$("$trusted_node" "$_inflight_lib_dir/../../.github/scripts/authorize-coordinator-worker.mjs" worker 2>/dev/null)" || {
      echo "Refusing worker promotion: a production release coordinator is active and this process is not its authenticated worker job." >&2
      echo "$coordinator_runs" >&2
      return 1
    }
    coordinator_auth_id="${coordinator_auth%%$'\t'*}"
    if [ "$(printf '%s\n' "$coordinator_auth_id" | wc -l | tr -d ' ')" != 1 ] || [ -z "$coordinator_auth_id" ]; then
      echo "Refusing worker promotion: coordinator job identity was malformed." >&2
      return 1
    fi
    other_coordinators="$(printf '%s\n' "$coordinator_runs" | awk -F'\t' -v self="$coordinator_auth_id" '$1 != self')"
    own_coordinator="$(printf '%s\n' "$coordinator_runs" | awk -F'\t' -v self="$coordinator_auth_id" '$1 == self')"
    if [ -z "$own_coordinator" ] || [ -n "$other_coordinators" ]; then
      echo "Refusing worker promotion: a different, duplicate, or unverified coordinator run is active." >&2
      printf '%s\n' "$coordinator_runs" >&2
      return 1
    fi
  fi
}

record_deploy_workflow_promote() {
  record_sha="${1:?promoted SHA is required}"
  # Phase-aware failure voice: pre-flip failures refuse before any
  # mutation; post-flip failures report the landed-but-unrecorded
  # state; restore failures report the rolled-back-but-unrecorded
  # state (restore-window runs read a candidate that no longer exists).
  record_phase="${2:-post}"
  case "$record_phase" in
    pre)
      record_refused="Refusing worker promotion"
      record_aftermath="Nothing was mutated; fix the cause and rerun deploy.sh."
      ;;
    post)
      record_refused="Worker promotion is NOT recorded"
      record_aftermath="The promote already landed and must not stay unrecorded: deploy.sh rolls it back automatically, while a manual rollback operator must re-run this refresh once the cause is fixed. Then confirm no production deploy published off stale reads."
      ;;
    restore)
      record_refused="Rolled-back worker promote is NOT recorded"
      record_aftermath="The rollback already landed but restore-window runs are unrecorded and this deploy's promote barrier is stuck: manually confirm no production deploy published off the rolled-back candidate reads, clear the stale barrier per the cutover runbook, then re-run this restore record once the cause is fixed."
      ;;
    *)
      echo "Refusing to record worker promotion: unknown phase '$record_phase' (want 'pre', 'post', or 'restore')." >&2
      return 1
      ;;
  esac
  if [[ ! "$record_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Refusing to record worker promotion: expected a 40-hex SHA, got '$record_sha'." >&2
    return 1
  fi
  _set_inflight_repo || return 1
  if ! _resolve_inflight_gh; then
    echo "$record_refused: the pinned GitHub CLI is missing or has an untrusted owner or mode. $record_aftermath" >&2
    return 1
  fi
  # List AFTER promote so flip-window runs prove overlap themselves.
  record_err="$(mktemp 2>/dev/null)" || record_err=""
  # Capture first, parse second: without pipefail a `$(_list | cut
  # | paste)` pipeline reports paste's status — a masked list failure
  # would record a vacuous overlap set.
  if ! record_deploy_tsv="$(_list_noncompleted_deploy_runs "$record_err")"; then
    record_detail=""
    if [ -n "$record_err" ]; then
      record_detail="$(head -c 500 "$record_err" 2>/dev/null || true)"
      rm -f "$record_err"
    fi
    echo "$record_refused: could not list workflow runs${record_detail:+: $record_detail}. $record_aftermath" >&2
    return 1
  fi
  if [ -n "$record_err" ]; then rm -f "$record_err"; fi
  record_err="$(mktemp 2>/dev/null)" || record_err=""
  if ! record_coordinator_tsv="$(_list_noncompleted_workflow_runs production-release.yml "$record_err")"; then
    record_detail=""
    if [ -n "$record_err" ]; then record_detail="$(head -c 500 "$record_err" 2>/dev/null || true)"; rm -f "$record_err"; fi
    echo "$record_refused: could not list coordinator runs${record_detail:+: $record_detail}. $record_aftermath" >&2
    return 1
  fi
  if [ -n "$record_err" ]; then rm -f "$record_err"; fi
  record_tsv="${record_deploy_tsv}${record_coordinator_tsv:+
$record_coordinator_tsv}"
  if [ -n "$record_tsv" ]; then
    record_runs="$(printf '%s\n' "$record_tsv" | cut -f1 | paste -sd, -)"
  else
    record_runs=""
  fi
  record_value="$record_sha:$record_runs"
  record_attempt=0
  while [ "$record_attempt" -lt 3 ]; do
    record_attempt=$((record_attempt + 1))
    if _push_promote_record "$record_value"; then
      if [ -n "$record_runs" ]; then
        record_overlap="overlapping runs: $record_runs"
      else
        record_overlap="no overlapping runs"
      fi
      if [ "$record_phase" = "pre" ]; then
        echo "Recorded pre-promote overlap for $record_sha ($record_overlap); the post-flip refresh follows."
      elif [ "$record_phase" = "restore" ]; then
        echo "Recorded restore-window overlap for rolled-back $record_sha ($record_overlap); affected runs refuse at publish."
      else
        echo "Recorded worker promote $record_sha ($record_overlap)."
      fi
      return 0
    fi
  done
  echo "$record_refused: could not push $PROMOTE_RECORD_BRANCH to origin after 3 attempts. $record_aftermath" >&2
  return 1
}

_push_promote_record() {
  push_value="$1"
  push_ref="refs/baci-tmp/promote-record"
  # No [skip ci]: the pre-push hook is bypassable, so the Ops
  # Promote Record workflow re-validates this branch from the last
  # validated tip on a 15-minute schedule (a push trigger cannot work:
  # the orphan branch never contains workflow files). Detection lags
  # up to the schedule interval — a --no-verify push is NOT
  # immediately server-validated.
  push_msg="record worker promote overlap ${push_value%%:*}"
  # Plumbing only: no checkout touched. Committer identity rides on
  # the command line so a bare-bones operator clone (no user.name or
  # user.email configured) still records.
  push_blob="$(printf '%s\n' "$push_value" | git hash-object -w --stdin)" || return 1
  push_base=""
  if git fetch --quiet origin "$PROMOTE_RECORD_BRANCH:$push_ref" 2>/dev/null; then
    push_base="$push_ref"
  fi
  push_tree="$(promote_record_tree "$push_blob" "$record_phase" "$record_sha" "$push_base")" || return 1
  if [ -n "$push_base" ]; then
    push_commit="$(GIT_AUTHOR_NAME='baci-deploy' GIT_AUTHOR_EMAIL='baci-deploy@users.noreply.github.com' GIT_COMMITTER_NAME='baci-deploy' GIT_COMMITTER_EMAIL='baci-deploy@users.noreply.github.com' git commit-tree "$push_tree" -p "$push_ref" -m "$push_msg")" || return 1
  else
    # First record (branch absent) — or an unreachable origin, in
    # which case the push below fails and the caller retries/loud-fails.
    push_commit="$(GIT_AUTHOR_NAME='baci-deploy' GIT_AUTHOR_EMAIL='baci-deploy@users.noreply.github.com' GIT_COMMITTER_NAME='baci-deploy' GIT_COMMITTER_EMAIL='baci-deploy@users.noreply.github.com' git commit-tree "$push_tree" -m "$push_msg")" || return 1
  fi
  git push --quiet origin "$push_commit:refs/heads/$PROMOTE_RECORD_BRANCH" 2>/dev/null
}

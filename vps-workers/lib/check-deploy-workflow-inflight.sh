#!/usr/bin/env bash
# Serializes manual worker promotion with the production deploy
# workflow. Sourced by deploy.sh.
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
# - record_deploy_workflow_promote (TWICE: immediately before the flip
#   as a fail-closed gate, and immediately after as a refresh): records
#   the promoted SHA plus the runs in flight at record time in a
#   single-file ops branch (ops/gigl-promote-record). The workflow's
#   pre-publish step reads that file live and refuses to publish when
#   its own run id is in the record — true mutual exclusion even for
#   runs that were invisible to the pre-promote query. The pre-flip
#   write is the fail-closed half: when the record path is broken
#   (auth, network, permissions), the promote is refused before
#   anything is mutated, so a promote can never land that no workflow
#   can see. If the post-flip refresh fails, deploy.sh rolls the
#   promotion back (tree + checkout pointer + marker) and exits
#   before any install runs — a slow promote lets flip-window runs
#   read pre-flip state the standing pre-flip record cannot list, so
#   no unrecorded tree may stay live. Run ids, not
#   timestamps: no clocks, no TTL, no stale state — a record only ever
#   matches live runs. The store is a branch (not an Actions variable)
#   because GITHUB_TOKEN cannot be granted the Variables permission;
#   the contents API read works under the job's existing contents:read.

_inflight_owner=""
_inflight_repo=""

PROMOTE_RECORD_BRANCH="ops/gigl-promote-record"
PROMOTE_RECORD_FILE=".gigl-promote-record"

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
      return 1
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
    return 1
  fi
  _inflight_owner="${inflight_repo%%/*}"
  _inflight_repo="${inflight_repo#*/}"
}

# Lists every non-completed main-branch deploy.yml run as TSV (id,
# status, short-sha, event, url) with NO fixed recent-run window. A
# `gh run list --limit N` query applies its jq filter AFTER the limit,
# so an approval-held run older than N newer runs is invisible both to
# the pre-promote refusal and to the promote record — and the older
# workflow then publishes off stale readiness state. The Actions API
# filters each non-completed status server-side instead, so every
# query returns ~zero rows in one page however many completed runs
# exist; --paginate covers an arbitrarily deep non-completed backlog,
# and the client-side completed-guard keeps a future API behavior
# change fail-safe instead of fail-open. Prints nothing when quiet.
# A run that transitions status mid-scan (requested -> queued is a
# normal lifecycle step) can dodge a single pass — queried under its
# old status before the transition and under its new status after —
# so the full scan repeats until two consecutive passes observe the
# same id set (stable: nothing transitioned mid-scan), capped at
# three passes. Every pass unions in and ids dedupe: the result can
# only over-include (a run that completes mid-scan may linger), and
# over-inclusion fails safe on both sides (refusal + record match).
# Usage: _list_noncompleted_deploy_runs <err-file-or-empty>.
_list_noncompleted_deploy_runs() {
  local _list_err_file="$1"
  local _list_pass _list_status _list_page
  local _list_pass_tsv _list_pass_ids _list_prev_ids _list_acc
  _list_acc=""
  _list_prev_ids="unseen"
  _list_pass=1
  while [ "$_list_pass" -le 3 ]; do
    _list_pass_tsv=""
    for _list_status in queued in_progress waiting requested pending; do
      if ! _list_page="$(gh api "repos/$_inflight_owner/$_inflight_repo/actions/workflows/deploy.yml/runs?branch=main&status=$_list_status&per_page=100" --paginate \
        --jq '.workflow_runs[] | select(.status != "completed") | "\(.id)\t\(.status)\t\((.head_sha // "?")[0:8])\t\(.event // "?")\t\(.html_url)"' \
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

check_deploy_workflow_inflight() {
  if [ "${BACI_DEPLOY_SKIP_INFLIGHT_CHECK:-}" = "1" ]; then
    echo "WARNING: skipping the pre-promote in-flight deploy check (BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1). The promote is still recorded for the workflow pre-publish overlap check when gh works; re-run the GIGL smoke/latch sequence after this promote and confirm no production deploy published off the pre-promote latch/SHA." >&2
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "Refusing worker promotion: the gh CLI is not installed, so in-flight production deploys cannot be ruled out. Install and authenticate gh, or (emergency only) rerun with BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1 and re-verify the latch afterwards." >&2
    return 1
  fi
  _set_inflight_repo || return 1
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
    echo "Refusing worker promotion: could not list production deploy runs${inflight_detail:+: $inflight_detail}. Authenticate gh (gh auth login), or (emergency only) rerun with BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1 and re-verify the latch afterwards." >&2
    return 1
  fi
  if [ -n "$inflight_err" ]; then rm -f "$inflight_err"; fi
  if [ -n "$inflight_runs" ]; then
    echo "Refusing worker promotion: production deploy run(s) still in flight (they publish off the pre-promote latch/SHA):" >&2
    echo "$inflight_runs" >&2
    echo "Wait for the workflow to finish, then rerun deploy.sh. Emergency override: BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1 (then re-run the GIGL smoke/latch sequence before relying on the poller)." >&2
    return 1
  fi
}

record_deploy_workflow_promote() {
  record_sha="${1:?promoted SHA is required}"
  # Phase-aware failure voice: pre-flip failures refuse before any
  # mutation; post-flip failures report the landed-but-unrecorded state.
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
    *)
      echo "Refusing to record worker promotion: unknown phase '$record_phase' (want 'pre' or 'post')." >&2
      return 1
      ;;
  esac
  if [[ ! "$record_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Refusing to record worker promotion: expected a 40-hex SHA, got '$record_sha'." >&2
    return 1
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
      echo "$record_refused: the gh CLI is not installed, so overlapping workflow runs cannot be warned. $record_aftermath" >&2
      return 1
    fi
    echo "WARNING: worker promotion is NOT recorded (no gh CLI under BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1). Manually confirm no production deploy published off the pre-promote latch/SHA." >&2
    return 0
  fi
  _set_inflight_repo || return 1
  # List AFTER promote: runs that appeared during the promote read
  # torn (fail-closed marker mismatch) or fresh post-promote state,
  # but recording them is what lets their own pre-publish step prove
  # that instead of trusting this comment.
  record_err="$(mktemp 2>/dev/null)" || record_err=""
  # Capture first, parse second: a `$(_list ... | cut | paste)`
  # pipeline reports paste's status without pipefail, and callers
  # (runbook one-liners) cannot be assumed to set it — a masked list
  # failure would record a vacuous overlap set.
  if ! record_tsv="$(_list_noncompleted_deploy_runs "$record_err")"; then
    record_detail=""
    if [ -n "$record_err" ]; then
      record_detail="$(head -c 500 "$record_err" 2>/dev/null || true)"
      rm -f "$record_err"
    fi
    if [ "$record_strict" = "1" ]; then
      echo "$record_refused: could not list workflow runs${record_detail:+: $record_detail}. $record_aftermath" >&2
      return 1
    fi
    echo "WARNING: worker promotion is NOT recorded (run list failed under BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1${record_detail:+: $record_detail}). Manually confirm no production deploy published off the pre-promote latch/SHA." >&2
    return 0
  fi
  if [ -n "$record_err" ]; then rm -f "$record_err"; fi
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
      else
        echo "Recorded worker promote $record_sha ($record_overlap)."
      fi
      return 0
    fi
  done
  if [ "$record_strict" = "1" ]; then
    echo "$record_refused: could not push $PROMOTE_RECORD_BRANCH to origin after 3 attempts. $record_aftermath" >&2
    return 1
  fi
  echo "WARNING: worker promotion is NOT recorded (branch push failed under BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1). Manually confirm no production deploy published off the pre-promote latch/SHA." >&2
  return 0
}

_push_promote_record() {
  push_value="$1"
  push_ref="refs/baci-tmp/promote-record"
  push_msg="record worker promote ${push_value%%:*} [skip ci]"
  # Plumbing only: no checkout touched. Committer identity rides on
  # the command line so a bare-bones operator clone (no user.name or
  # user.email configured) still records.
  push_blob="$(printf '%s\n' "$push_value" | git hash-object -w --stdin)" || return 1
  push_tree="$(printf '100644 blob %s\t%s\n' "$push_blob" "$PROMOTE_RECORD_FILE" | git mktree)" || return 1
  if git fetch --quiet origin "$PROMOTE_RECORD_BRANCH:$push_ref" 2>/dev/null; then
    push_commit="$(GIT_AUTHOR_NAME='baci-deploy' GIT_AUTHOR_EMAIL='baci-deploy@users.noreply.github.com' GIT_COMMITTER_NAME='baci-deploy' GIT_COMMITTER_EMAIL='baci-deploy@users.noreply.github.com' git commit-tree "$push_tree" -p "$push_ref" -m "$push_msg")" || return 1
  else
    # First record (branch absent) — or an unreachable origin, in
    # which case the push below fails and the caller retries/loud-fails.
    push_commit="$(GIT_AUTHOR_NAME='baci-deploy' GIT_AUTHOR_EMAIL='baci-deploy@users.noreply.github.com' GIT_COMMITTER_NAME='baci-deploy' GIT_COMMITTER_EMAIL='baci-deploy@users.noreply.github.com' git commit-tree "$push_tree" -m "$push_msg")" || return 1
  fi
  git push --quiet origin "$push_commit:refs/heads/$PROMOTE_RECORD_BRANCH" 2>/dev/null
}

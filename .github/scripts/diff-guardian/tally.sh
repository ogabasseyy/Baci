#!/usr/bin/env bash
# Diff Guardian tally: reads the AI reviewers' results for ONE pull request head and posts ONE
# commit status, `Diff Guardian / quorum`. It runs from the DEFAULT branch (a sparse checkout of
# .github/scripts/diff-guardian) and never checks out or executes pull-request code.
#
# Env in: GH_TOKEN, REPO, SHA, PR, EVENT_ACTION, EVENT_LABEL, VOTERS, BLOCK_QUORUM, SCRIPT_DIR,
#   GITHUB_RUN_ID. Voting rules live in votes.sh.
set -euo pipefail

set_status() { # state, description
  gh api -X POST "repos/$REPO/statuses/$SHA" \
    -f state="$1" \
    -f context='Diff Guardian / quorum' \
    -f description="$2" \
    -f target_url="https://github.com/$REPO/actions/runs/${GITHUB_RUN_ID}" >/dev/null
}

resolve_pr_from_commit() {
  [ -n "${SHA:-}" ] || return 0
  gh api \
    -H 'Accept: application/vnd.github+json' \
    "repos/$REPO/commits/$SHA/pulls" \
    --jq '.[0].number // empty' 2>/dev/null || true
}

if [ -z "${PR:-}" ]; then
  PR="$(resolve_pr_from_commit)"
fi

if [ -z "${PR:-}" ]; then
  echo "::notice::Diff Guardian trigger has no associated PR; nothing to tally."
  exit 0
fi

# A transient API failure must not turn the job red or overwrite a decided status: keep the
# previous status; the next event (a reviewer finishing, a push) tallies again.
if ! pr_json="$(gh api "repos/$REPO/pulls/$PR" 2>/dev/null)"; then
  echo "::warning::Diff Guardian could not read pull request #$PR; keeping the previous status until the next event re-tallies."
  exit 0
fi
current_sha="$(printf '%s' "$pr_json" | jq -r '.head.sha')"
if [ -z "${SHA:-}" ]; then
  SHA="$current_sha"
fi
if [ "$SHA" != "$current_sha" ]; then
  echo "::notice::Ignoring stale Diff Guardian trigger for $SHA; PR #$PR now points at $current_sha."
  exit 0
fi

head_repo="$(printf '%s' "$pr_json" | jq -r '.head.repo.full_name')"
has_bypass="$(printf '%s' "$pr_json" | jq -r '[.labels[].name] | index("bypass-ai-gate") != null')"
is_fork_pr="false"
if [ "$head_repo" != "$REPO" ]; then
  is_fork_pr="true"
fi

if [ "$has_bypass" = "true" ]; then
  # Security: on a FORK PR, an external contributor can push new commits
  # after a maintainer applied the bypass. Do not honor a stale bypass
  # across a fork head change — require the maintainer to re-review and
  # re-apply the label (re-adding fires a fresh `labeled` event).
  if [ "$is_fork_pr" = "true" ] && [ "$EVENT_ACTION" = "synchronize" ]; then
    echo "::error::Fork PR changed after 'bypass-ai-gate' was applied. Re-review the new commits and re-apply the label."
    set_status failure "Fork PR changed; re-review and re-apply bypass-ai-gate"
    exit 1
  fi
  echo "::notice::'bypass-ai-gate' label present — Diff Guardian passing without tallying."
  set_status success "Bypassed via bypass-ai-gate label"
  exit 0
fi
# Removing the bypass label does not re-run the individual voters.
# Fail closed until a new commit re-runs them, otherwise stale
# bypass-success votes can be misread as real review passes.
if [ "$EVENT_ACTION" = "unlabeled" ] && [ "$EVENT_LABEL" = "bypass-ai-gate" ]; then
  echo "::error::'bypass-ai-gate' label was removed. Push a new commit to re-run AI reviewers before Diff Guardian can tally them."
  set_status failure "Push a new commit after removing bypass-ai-gate"
  exit 1
fi

# Fork PRs get no automatic same-repo voter runs, and GitHub does not
# reliably carry the PR head SHA to comment-triggered voter
# `workflow_run` completions, so a manual fork review cannot be
# re-tallied against this head. Fail closed: a maintainer reviews the
# fork PR and adds 'bypass-ai-gate' to merge (bypass is honored above).
if [ "$is_fork_pr" = "true" ]; then
  echo "::error::Diff Guardian: fork PR requires maintainer review + the 'bypass-ai-gate' label to merge."
  set_status failure "Fork PR: add 'bypass-ai-gate' after maintainer review"
  exit 1
fi

# Every event (pull_request_target incl. label changes, and reviewer
# workflow_run completions) flows into the single tally below. The tally
# is idempotent: with no voter results yet it posts `pending`; a
# label-only change therefore never clobbers an already-decided status,
# and a reviewer completion always re-tallies.

# Pipe-separated -> newline list of voter contexts.
# shellcheck disable=SC2153  # VOTERS (from the environment) is not a typo of voters (derived here)
voters="$(printf '%s\n' "$VOTERS" | tr '|' '\n' | sed '/^$/d')"
voter_count="$(printf '%s\n' "$voters" | grep -c . || true)"
echo "Voters ($voter_count): $(printf '%s' "$VOTERS")  |  block quorum: $BLOCK_QUORUM"

# shellcheck source=votes.sh
. "${SCRIPT_DIR}/votes.sh"

combined="$(gh api "repos/$REPO/commits/$SHA/status" 2>/dev/null || echo '{"statuses":[]}')"
checks="$(gh api --paginate "repos/$REPO/commits/$SHA/check-runs?per_page=100" 2>/dev/null | jq -s '{"check_runs":[.[].check_runs[]?]}' 2>/dev/null || echo '{"check_runs":[]}')"
reviews_raw="$(gh api --paginate "repos/$REPO/pulls/$PR/reviews?per_page=100" 2>/dev/null)" || reviews_raw='[]'
reviews="$(printf '%s' "$reviews_raw" | jq -s 'add // []' 2>/dev/null)" || reviews='[]'

reported=0 ; blocking=0 ; active_pending=0 ; abstained=0 ; missing=0 ; summary=""
while IFS= read -r ctx; do
  [ -z "$ctx" ] && continue
  st="$(voter_state "$combined" "$checks" "$ctx" "$reviews")"
  if [ "$st" = "missing" ] && ! workflow_runnable "$ctx"; then
    st="abstain"
  fi
  summary="${summary}${ctx}=${st}; "
  case "$st" in
    failure) reported=$((reported+1)); blocking=$((blocking+1)) ;;
    success) reported=$((reported+1)) ;;
    pending) active_pending=$((active_pending+1)) ;;
    abstain) abstained=$((abstained+1)) ;;
    *)       missing=$((missing+1)) ;;
  esac
done <<< "$voters"

# "Outstanding" = voters that have NOT reported a verdict yet but still
# could (running, or no check created yet). Abstentions (done, no
# verdict — timeout/outage) are final and excluded, so an outage can
# never keep the gate pending nor count toward the block quorum.
unknown=$((active_pending + missing))
echo "${summary}| reported=$reported blocking=$blocking pending=$active_pending abstained=$abstained missing=$missing outstanding=$unknown quorum=$BLOCK_QUORUM"

# BLOCK: a quorum of voters reported real, blocking failures.
if [ "$blocking" -ge "$BLOCK_QUORUM" ]; then
  echo "::error::Diff Guardian: $blocking reviewers flagged blocking issues (quorum $BLOCK_QUORUM). Fix the findings, or add 'bypass-ai-gate'."
  set_status failure "$blocking reviewers flagged blocking issues (quorum $BLOCK_QUORUM)"
  exit 1
fi

# PASS: even if every still-outstanding voter were to fail, the block
# quorum is unreachable. Covers all-success, success+lone-failure, and
# one-real-failure+one-abstention (an outage never blocks).
if [ $((blocking + unknown)) -lt "$BLOCK_QUORUM" ]; then
  echo "Diff Guardian: block quorum unreachable ($blocking blocking + $unknown outstanding < $BLOCK_QUORUM) — passing."
  set_status success "No reviewer quorum on blocking issues ($blocking/$BLOCK_QUORUM)"
  exit 0
fi

# Otherwise an outstanding voter could still reach the block quorum. Stay
# pending; a reviewer workflow_run completion re-tallies. There is no
# fixed poll window, so a slow voter (a reviewer run can take many minutes)
# is always awaited rather than declared green prematurely.
echo "Diff Guardian: outstanding voters could still reach block quorum; awaiting completion."
set_status pending "Waiting for AI reviewer completion"

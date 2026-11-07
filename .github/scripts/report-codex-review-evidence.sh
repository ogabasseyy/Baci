#!/usr/bin/env bash
set -euo pipefail

repo=${1:?repository required}
pr=${2:?pull request number required}
case "$pr" in *[!0-9]*|'') echo 'Invalid pull request number' >&2; exit 1;; esac
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || exit 1

get_head() { gh api "repos/$repo/pulls/$pr" --jq .head.sha; }
post_status() {
  gh api --method POST "repos/$repo/statuses/$head" \
    -f state="$1" -f context='Codex review evidence / code' \
    -f description="$2" -f target_url="${GITHUB_SERVER_URL}/${repo}/actions/runs/${GITHUB_RUN_ID}" >/dev/null
}

head=$(get_head)
[[ "$head" =~ ^[0-9a-f]{40}$ ]] || exit 1
# Supersede any earlier result before fetching mutable comments. API or parse
# failures leave this observation pending rather than publishing a clean vote.
post_status pending 'Checking the current Codex code review'
comments=$(mktemp "${RUNNER_TEMP:?}/codex-review.XXXXXXXX")
confirm=$(mktemp "${RUNNER_TEMP:?}/codex-review.XXXXXXXX")
trap 'rm -f "$comments" "$confirm"' EXIT
gh api --paginate --slurp "repos/$repo/issues/$pr/comments?per_page=100" > "$comments"
result=$(node .github/scripts/codex-review-evidence-cli.mjs "$comments" "$head")
gh api --paginate --slurp "repos/$repo/issues/$pr/comments?per_page=100" > "$confirm"
# Validate the second response too, then compare only authoritative app
# comments so an unrelated discussion cannot strand the observation.
node .github/scripts/codex-review-evidence-cli.mjs "$confirm" "$head" >/dev/null
projection() {
  node .github/scripts/codex-review-evidence-cli.mjs --project "$1"
}
first_projection=$(projection "$comments")
second_projection=$(projection "$confirm")
if [[ "$first_projection" != "$second_projection" ]]; then
  echo 'Codex comments changed during observation; leaving the status pending.'
  exit 0
fi
if [[ "$(get_head)" != "$head" ]]; then
  echo 'PR head changed during review observation; leaving old head pending.'
  exit 0
fi
case "$result" in
  clean) post_status success 'Codex code review completed on this commit' ;;
  findings) post_status failure 'Codex code review has unresolved findings' ;;
  pending|stale|unavailable|ambiguous) post_status pending "Codex review evidence: $result" ;;
  *) echo 'Unexpected review evidence state' >&2; exit 1 ;;
esac

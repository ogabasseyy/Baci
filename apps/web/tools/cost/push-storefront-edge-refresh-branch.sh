#!/usr/bin/env bash
# Commits the regenerated storefront edge inventory files onto BRANCH and
# pushes it, or reuses BRANCH when an earlier attempt already pushed exactly
# this refresh (a rerun after a push that never reached `gh pr create`).
#
# Usage: push-storefront-edge-refresh-branch.sh <branch> <source-sha> <inventory-path> <test-path> [commit-body]
# The two files must already hold the regenerated content in the working tree.
# GIT_PUSH_AUTH_HEADER, when set, is sent as http.extraheader for fetch/push.
# Prints "pushed" or "reused"; exits non-zero when BRANCH exists but carries
# anything other than one commit on SOURCE_SHA with exactly these two files.
set -euo pipefail

branch="$1"
source_sha="$2"
inventory_path="$3"
test_path="$4"
commit_body="${5:-}"

# Only ever an automation branch head, never a tag or another ref: the
# storefront release workflows start from tag pushes.
if ! printf '%s\n' "$branch" | grep -Eqx 'automation/storefront-edge-inventory-[a-f0-9]{12}-[a-f0-9]{12}'; then
  echo "::error::refusing to push unexpected ref name: $branch" >&2
  exit 1
fi

git_remote() {
  if [ -n "${GIT_PUSH_AUTH_HEADER:-}" ]; then
    git -c http.extraheader="$GIT_PUSH_AUTH_HEADER" "$@"
  else
    git "$@"
  fi
}

git add -- "$inventory_path" "$test_path"
if git_remote fetch --quiet --depth=2 origin "refs/heads/$branch" 2>/dev/null; then
  foreign="$(git diff --name-only "$source_sha" FETCH_HEAD | grep -vxF -e "$inventory_path" -e "$test_path" || true)"
  if [ "$(git rev-parse FETCH_HEAD^)" != "$source_sha" ] \
    || [ -n "$foreign" ] \
    || ! git diff --cached --quiet FETCH_HEAD -- "$inventory_path" "$test_path"; then
    echo "::error::Existing branch $branch does not carry exactly this refresh; refusing to reuse it." >&2
    exit 1
  fi
  echo reused
  exit 0
fi

git switch --quiet -c "$branch"
git commit --quiet -m "fix(ci): refresh storefront edge inventory snapshot" \
  ${commit_body:+-m "$commit_body"}
git_remote push --quiet origin "HEAD:refs/heads/$branch"
echo pushed

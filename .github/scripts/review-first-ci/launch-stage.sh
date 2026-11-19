#!/usr/bin/env bash
entry=.github/scripts/review-first-ci/resolve-stage.mjs
fail_closed() {
  echo "::error title=Review-first CI::$1; failing closed: quick checks only"
  printf 'stage=quick\ncode=resolver-failed\nreason=%s\n' "$1" >> "$GITHUB_OUTPUT"
}
if ! git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then
  fail_closed "the base commit is not in this checkout"
  exit 0
fi
# The gate decides whether this pull request may start the expensive CI, so the pull
# request must not be able to edit it: run the base branch's copy as soon as the base
# has one. Only the pull request that introduces the scripts runs its own copy.
if git cat-file -e "${BASE_SHA}:${entry}" 2>/dev/null; then
  base_dir="${RUNNER_TEMP}/review-first-ci-base"
  mkdir -p "$base_dir"
  git archive "$BASE_SHA" .github/scripts/review-first-ci | tar -x -C "$base_dir"
  entry="${base_dir}/${entry}"
else
  echo "::warning title=Review-first CI::the base branch has no review-first scripts yet; using this pull request's copy"
fi
status=0
node "$entry" || status=$?
if [ "$status" -ne 0 ] || ! grep -q '^stage=' "$GITHUB_OUTPUT"; then
  fail_closed "the stage resolver failed (exit $status)"
fi

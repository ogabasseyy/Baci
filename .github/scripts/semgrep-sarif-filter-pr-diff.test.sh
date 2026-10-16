#!/usr/bin/env bash
# Regression test for the fail-closed PR base diff (security.yml PR
# scan step). Reproduces the missing/bad base ref and proves the
# construction exits nonzero instead of producing an empty scan
# scope. Uses a scratch git repo. This guards the shell mechanism;
# the exact YAML text is pinned by the fail-closed sync pins in
# semgrep-sarif-filter-trusted-sync.test.sh. No third-party deps.
set -euo pipefail

fail=0
t="$(mktemp -d)"
trap 'rm -rf "$t"' EXIT
cd "$t"
git init -q
git config user.email t@t.t
git config user.name t
echo one > a.ts
git add -A
git -c core.hooksPath=/dev/null commit -qm base
echo two > b.ts
git add -A
git -c core.hooksPath=/dev/null commit -qm head
base="$(git rev-parse HEAD~1)"

# 1. Valid base lists the changed file (mirrors the security.yml diff).
# String compare (no mapfile/arrays) so this also runs on bash 3.2.
diff_out="$(git diff --name-only --diff-filter=d "$base...HEAD" -- '*.ts')" || {
  echo "::error::valid base unexpectedly failed"
  exit 1
}
[[ "$diff_out" == "b.ts" ]] || {
  echo "::error::valid base did not list exactly b.ts: [$diff_out]"
  fail=1
}

# 2. Bogus base (the #3695 condition: deleted/missing base ref) must
# exit nonzero instead of yielding an empty scope.
if (
  diff_out="$(git diff --name-only --diff-filter=d "origin/nonexistent...HEAD" -- '*.ts' 2>/dev/null)" || {
    echo "::error::PR base diff failed; failing closed instead of skipping the scan."
    exit 1
  }
); then
  echo "::error::bogus base did not fail closed"
  fail=1
fi

# 3. Valid base with no matching files is a legitimate empty scope
# (the skip path), not a failure.
diff_out="$(git diff --name-only --diff-filter=d "$base...HEAD" -- '*.py')" || {
  echo "::error::valid base unexpectedly failed"
  exit 1
}
[[ -z "$diff_out" ]] || {
  echo "::error::expected empty scope, got [$diff_out]"
  fail=1
}

if [[ "$fail" -eq 0 ]]; then
  echo "pr-diff fail-closed: OK (listed, failed-closed, empty-skip)"
fi
exit "$fail"

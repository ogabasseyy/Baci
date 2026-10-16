#!/usr/bin/env bash
# Regression test for the fail-closed PR base diff. Exercises the
# REAL changed-files script (not a mirror): a bogus base ref must
# exit nonzero, a valid base must list the changed security-relevant
# file, and a valid base with no matching paths must exit 0 empty
# (the legitimate skip). Scratch git repo; bash-3.2 portable.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/semgrep-sarif-filter-pr-changed-files.sh"

fail=0
t="$(mktemp -d)"
trap 'rm -rf "$t"' EXIT
cd "$t"
git init -q
git config user.email t@t.t
git config user.name t
mkdir -p apps/web/src/app/api
echo one > apps/web/src/app/api/a.ts
git add -A
git -c core.hooksPath=/dev/null commit -qm base
echo two > apps/web/src/app/api/b.ts
git add -A
git -c core.hooksPath=/dev/null commit -qm head
base="$(git rev-parse HEAD~1)"

# 1. Valid base lists the changed file. Fixture paths must fall inside
# the script's security-relevant scope (bare root files are filtered
# out by design). String compare (no mapfile/arrays): bash 3.2 OK.
out="$("$SCRIPT" "$base")" || {
  echo "::error::valid base unexpectedly failed"
  fail=1
}
[[ "$out" == "apps/web/src/app/api/b.ts" ]] || {
  echo "::error::valid base did not list exactly the changed file: [$out]"
  fail=1
}

# 2. Bogus base (the #3695 condition: deleted/missing base ref) must
# exit nonzero instead of yielding an empty scope.
if out="$("$SCRIPT" origin/nonexistent 2>/dev/null)"; then
  echo "::error::bogus base did not fail closed (printed [$out])"
  fail=1
fi

# 3. A diff touching only out-of-scope paths is a legitimate empty
# scope (the skip path), not a failure.
mkdir -p docs
echo x > docs/note.md
git add -A
git -c core.hooksPath=/dev/null commit -qm docs-only
base2="$(git rev-parse HEAD~1)"
out="$("$SCRIPT" "$base2")" || {
  echo "::error::docs-only diff unexpectedly failed"
  fail=1
}
[[ -z "$out" ]] || {
  echo "::error::expected empty scope, got [$out]"
  fail=1
}

if [[ "$fail" -eq 0 ]]; then
  echo "pr-diff fail-closed: OK (listed, failed-closed, empty-skip)"
fi
exit "$fail"

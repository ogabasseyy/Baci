#!/bin/sh
# Prints the HEAD/origin/main merge base so local quality gates can run turbo --affected; empty output means run the full gate.
set -eu

if [ "${QUALITY_GATE_FULL:-}" = "1" ]; then
  exit 0
fi

dir="${1:-.}"

base=$(git -C "$dir" merge-base HEAD origin/main 2>/dev/null) || exit 0

case "$base" in
  '' | *[!0-9a-f]*) exit 0 ;;
esac

# Turbo maps changes only to workspace packages (apps/*, packages/*). A change
# elsewhere, such as supabase/migrations or root config, selects no package
# even though tests read it, so it keeps the full gate. Markdown outside the
# packages is read by no test. A failed listing also keeps the full gate.
outside=$(
  {
    git -C "$dir" diff --name-only "$base" -- 2>/dev/null || echo '<unknown>'
    git -C "$dir" ls-files --others --exclude-standard --full-name 2>/dev/null || echo '<unknown>'
  } | grep -v -E '^(apps|packages)/' | grep -v -E '\.md$' || true
)
if [ -n "$outside" ]; then
  exit 0
fi

printf '%s\n' "$base"

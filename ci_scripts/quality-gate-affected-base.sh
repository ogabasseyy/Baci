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
# even though tests may read it, so it keeps the full gate. Markdown elsewhere
# stays scoped unless a file under apps/ or packages/ names its path (a test
# that reads AGENTS.md, for example). Any listing or search error keeps the
# full gate.
changes=$(
  git -C "$dir" diff --name-only "$base" -- 2>/dev/null || echo '<unknown>'
  git -C "$dir" ls-files --others --exclude-standard --full-name 2>/dev/null || echo '<unknown>'
)
full_gate=$(
  printf '%s\n' "$changes" | while IFS= read -r path; do
    case "$path" in
      ('' | apps/* | packages/*) ;;
      (*.md)
        found=0
        git -C "$dir" grep -q -F -e "$path" -- apps packages 2>/dev/null || found=$?
        if [ "$found" -ne 1 ]; then
          echo full
        fi
        ;;
      (*) echo full ;;
    esac
  done
)
if [ -n "$full_gate" ]; then
  exit 0
fi

printf '%s\n' "$base"

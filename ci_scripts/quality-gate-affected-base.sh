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

# Turbo maps changes only to workspace packages (apps/*, packages/*), so keep
# the full gate when a change could reach tests it would not select:
# - a change outside the packages (supabase/migrations, root config), except
#   Markdown;
# - a changed path that a file in another workspace names (a storefront test
#   reading apps/mobile-admin/app.config.ts), or Markdown outside the packages
#   that any package file names (a test reading AGENTS.md).
# Any listing or search error also keeps the full gate.
changes=$(
  git -C "$dir" diff --name-only "$base" -- 2>/dev/null || echo '<unknown>'
  git -C "$dir" ls-files --others --exclude-standard --full-name 2>/dev/null || echo '<unknown>'
)
full_gate=$(
  printf '%s\n' "$changes" | while IFS= read -r path; do
    case "$path" in
      ('' | apps/* | packages/* | *.md) ;;
      (*) echo full ;;
    esac
  done
)
if [ -z "$full_gate" ]; then
  patterns=$(mktemp) || exit 0
  trap 'rm -f "$patterns"' EXIT
  printf '%s\n' "$changes" | grep -v '^$' > "$patterns" || true
  if [ -s "$patterns" ]; then
    found=0
    refs=$(git -C "$dir" grep -o -F -f "$patterns" -- apps packages 2>/dev/null) || found=$?
    if [ "$found" -gt 1 ]; then
      full_gate=full
    elif [ "$found" -eq 0 ]; then
      full_gate=$(printf '%s\n' "$refs" | awk '{
        n = index($0, ":"); file = substr($0, 1, n - 1); named = substr($0, n + 1)
        split(file, a, "/"); split(named, b, "/")
        if (named !~ /^(apps|packages)\// || a[1] "/" a[2] != b[1] "/" b[2]) { print "full"; exit }
      }')
    fi
  fi
fi
if [ -n "$full_gate" ]; then
  exit 0
fi

printf '%s\n' "$base"

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

# Turbo maps changes only to workspace packages (apps/<name>/, packages/<name>/),
# so keep the full gate when a change could reach tests it would not select:
# - a change outside the packages (supabase/migrations, root config, a file
#   directly under apps/ or packages/ that no workspace owns), except Markdown;
# - a change inside a nested workspace that pnpm-workspace.yaml declares below
#   one of those packages (apps/web/mcp-server/widgets): Turbo maps its files
#   to the nested package, not to the parent, so the ownership checks below do
#   not hold for it;
# - a changed path that a file in another workspace names (a storefront test
#   reading apps/mobile-admin/app.config.ts), or Markdown outside the packages
#   that any package file names (a test reading AGENTS.md). A rename counts as
#   both its old and its new path.
# Any listing or search error also keeps the full gate.
# The path search covers tracked and untracked files and is literal and
# best-effort: imports between packages are covered by Turbo's own package
# graph, while a path built at run time (join or resolve with variables) goes
# undetected; CI's Quality Gate still runs on every PR.
changes=$(
  git -C "$dir" diff --name-only --no-renames "$base" -- 2>/dev/null || echo '<unknown>'
  git -C "$dir" ls-files --others --exclude-standard --full-name 2>/dev/null || echo '<unknown>'
)

# Path prefixes of the nested workspaces, one per line, read from the "packages:"
# list of pnpm-workspace.yaml (entries other than apps/* and packages/*; a
# wildcard entry contributes the text before its first "*"). Without the file
# there are none.
nested_prefixes=$(
  awk '
    /^packages:/ { listing = 1; next }
    listing && /^[^[:space:]#-]/ { listing = 0 }
    listing && /^[[:space:]]*-/ {
      sub(/^[[:space:]]*-[[:space:]]*/, ""); sub(/[[:space:]]*#.*$/, ""); print
    }
  ' "$dir/pnpm-workspace.yaml" 2>/dev/null | tr -d "\"'" | while IFS= read -r entry; do
    case "$entry" in
      ('' | '!'* | 'apps/*' | 'packages/*') ;;
      (*'*'*) printf '%s\n' "${entry%%'*'*}" ;;
      (*) printf '%s/\n' "${entry%/}" ;;
    esac
  done
)

# Succeeds when "$1" lies inside a nested workspace.
in_nested_workspace() {
  [ -n "$nested_prefixes" ] || return 1
  while IFS= read -r prefix; do
    case "$1" in
      ("$prefix"*) [ -n "$prefix" ] && return 0 ;;
    esac
  done <<NESTED
$nested_prefixes
NESTED
  return 1
}

full_gate=$(
  printf '%s\n' "$changes" | while IFS= read -r path; do
    case "$path" in
      ('' | *.md) ;;
      (apps/*/* | packages/*/*)
        if in_nested_workspace "$path"; then echo full; fi ;;
      (*) echo full ;;
    esac
  done
)
if [ -z "$full_gate" ]; then
  patterns=$(mktemp "${TMPDIR:-/tmp}/qg-affected-patterns.XXXXXX") || exit 0
  trap 'rm -f "$patterns"' EXIT
  printf '%s\n' "$changes" | grep -v '^$' > "$patterns" || true
  if [ -s "$patterns" ]; then
    found=0
    refs=$(git -C "$dir" grep --untracked -o -F -f "$patterns" -- apps packages 2>/dev/null) || found=$?
    if [ "$found" -gt 1 ]; then
      full_gate=full
    elif [ "$found" -eq 0 ]; then
      full_gate=$(printf '%s\n' "$refs" | awk -v prefixes="$(printf '%s' "$nested_prefixes" | tr '\n' '|')" '
        function nested(path,   i) {
          for (i = 1; i <= count; i++) if (pre[i] != "" && index(path, pre[i]) == 1) return 1
          return 0
        }
        BEGIN { count = split(prefixes, pre, "|") }
        {
          n = index($0, ":"); file = substr($0, 1, n - 1); named = substr($0, n + 1)
          split(file, a, "/"); split(named, b, "/")
          if (named !~ /^(apps|packages)\// || nested(file) || nested(named) || a[1] "/" a[2] != b[1] "/" b[2]) { print "full"; exit }
        }')
    fi
  fi
fi
if [ -n "$full_gate" ]; then
  exit 0
fi

printf '%s\n' "$base"

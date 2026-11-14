#!/bin/bash
# Prints (one per line) the git worktrees THIS Claude session actually touched,
# so the Stop-hook quality gate never audits another agent's checkout.
#
# Usage: quality-gate-session-worktrees.sh <transcript.jsonl> <project_dir>
#
# Evidence taken from the session transcript (see quality-gate-session-paths.jq):
#   - Bash `cd`/`pushd` (chained in order, relative paths resolved), `git -C`,
#     `tee`, and `>`/`>>` redirect targets
#   - file paths of MUTATING tools (Edit/Write/NotebookEdit); Read does not count
#   - the per-entry `cwd`, but only when it is a LINKED worktree (a session that
#     merely started at the main checkout has not "touched" it)
#   - if nothing else qualifies but the session changed files, its last cwd
# Exit status 3 = transcript missing/unreadable/has no evidence at all; the
# caller then fails closed to the starting worktree.
# Each path is mapped to the longest matching entry of this repo's
# `git worktree list`. Worktrees under ~/.codex/ or ~/Documents/Codex/ are never
# returned (they belong to other agents). No evidence => prints nothing.

transcript="${1:-}"
project_dir="${2:-}"
[ -d "$project_dir" ] || exit 0
[ -n "$transcript" ] && [ -f "$transcript" ] || exit 3

home="${HOME:-}"
# shellcheck source=quality-gate-foreign.sh
source "$(dirname "$0")/quality-gate-foreign.sh"
worktrees=()
while IFS= read -r line; do
  case "$line" in
    "worktree "*) worktrees+=("${line#worktree }") ;;
  esac
done < <(git -C "$project_dir" worktree list --porcelain 2>/dev/null)
[ ${#worktrees[@]} -gt 0 ] || exit 0

# Evidence lines from the transcript (see the .jq file for the format).
extract_paths() {
  jq -r -f "$(dirname "$0")/quality-gate-session-paths.jq" "$transcript" 2>/dev/null |
    awk -F'\t' '
      $1 == "S"  { ctx = $0; print; next }
      $1 == "cd" { ctx = ctx "|" $0; print; next }
      !seen[ctx "|" $0]++'
}

# Resolve symlinks (macOS /var -> /private/var) on the deepest existing ancestor.
canon() {
  local p="$1" rest="" d
  while [ ! -d "$p" ] && [ "$p" != "/" ]; do rest="/$(basename "$p")$rest"; p="$(dirname "$p")"; done
  d=$(cd -P "$p" 2>/dev/null && pwd) || d="$p"
  printf '%s%s' "${d%/}" "$rest"
}

is_linked_worktree() { [ -f "$1/.git" ]; }

# Map a path to the longest matching worktree of this repo ("" if none).
worktree_of() {
  local cp cw wt best="" bestlen=0
  cp=$(canon "$1")
  for wt in "${worktrees[@]}"; do
    cw=$(canon "$wt")
    case "$cp" in
      "$cw"|"$cw"/*) if [ ${#cw} -gt "$bestlen" ]; then best="$wt"; bestlen=${#cw}; fi ;;
    esac
  done
  [ -n "$best" ] && [ -d "$best" ] && printf '%s' "$best"
  return 0
}

resolve_path() { # <base> <arg>
  local base="$1" a="$2"
  case "$a" in
    "~") a="$home" ;;
    "~"/*) a="$home/${a#\~/}" ;;
  esac
  case "$a" in
    /*) printf '%s' "$a" ;;
    *) [ -n "$base" ] && printf '%s/%s' "$base" "$a" ;;
  esac
}

found=()
mutated=0
resolved=0
seen=0
cwd=""
cur=""
last_cwd=""
add_wt() { # <path>
  local wt
  [ -n "$1" ] || return 0
  wt=$(worktree_of "$1")
  [ -n "$wt" ] || return 0
  resolved=1                       # evidence pointed at a real worktree
  is_foreign_agent_path "$wt" || found+=("$wt")
  return 0
}
while IFS=$'\t' read -r kind arg; do
  case "$kind" in
    S) seen=1; cwd="$arg"; cur="$arg" ;;
    M) mutated=1 ;;
    C)
      seen=1; last_cwd="$arg"
      # Starting inside a linked worktree means the session owns it; starting
      # at the main checkout does not (handled by the mutation fallback).
      wt=$(worktree_of "$arg")
      if [ -n "$wt" ] && is_linked_worktree "$wt" && ! is_foreign_agent_path "$wt"; then
        found+=("$wt"); resolved=1
      fi ;;
    cd) cur=$(resolve_path "$cur" "$arg"); add_wt "$cur" ;;
    p|F) add_wt "$(resolve_path "$([ "$kind" = F ] && echo "$cwd" || echo "$cur")" "$arg")" ;;
  esac
done < <(extract_paths)

[ "$seen" = 1 ] || exit 3

# Work done from the main checkout itself (relative paths, no cd): if nothing
# else identified a worktree but the session made changes, use its last cwd.
if [ "$resolved" = 0 ] && [ "$mutated" = 1 ] && [ -n "$last_cwd" ]; then
  add_wt "$last_cwd"
fi

[ ${#found[@]} -gt 0 ] && printf '%s\n' "${found[@]}" | sort -u
exit 0

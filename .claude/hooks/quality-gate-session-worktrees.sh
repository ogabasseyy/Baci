#!/bin/bash
# Prints (one per line) the git worktrees THIS Claude session actually touched,
# so the Stop-hook quality gate never audits another agent's checkout.
#
# Usage: quality-gate-session-worktrees.sh <transcript.jsonl> <project_dir>
#
# Evidence taken from the session transcript:
#   - Bash commands containing `cd <abs path>` or `git -C <abs path>`
#   - file_path / path / notebook_path inputs of tool calls (Edit, Write, Read, ...)
#   - the per-entry `cwd`, but only when it is a LINKED worktree (a session that
#     merely started at the main checkout has not "touched" it)
# Each path is mapped to the longest matching entry of this repo's
# `git worktree list`. Worktrees under ~/.codex/ or ~/Documents/Codex/ are never
# returned (they belong to other agents). No evidence => prints nothing.

transcript="${1:-}"
project_dir="${2:-}"
[ -n "$transcript" ] && [ -f "$transcript" ] && [ -d "$project_dir" ] || exit 0

home="${HOME:-}"
worktrees=()
while IFS= read -r line; do
  case "$line" in
    "worktree "*) worktrees+=("${line#worktree }") ;;
  esac
done < <(git -C "$project_dir" worktree list --porcelain 2>/dev/null)
[ ${#worktrees[@]} -gt 0 ] || exit 0

is_foreign_agent_path() {
  case "$1" in
    "$home"/.codex/*|"$home"/Documents/Codex/*) return 0 ;;
  esac
  return 1
}

# Evidence lines from the transcript (see the .jq file for the format).
extract_paths() {
  jq -r -f "$(dirname "$0")/quality-gate-session-paths.jq" "$transcript" 2>/dev/null | awk '!seen[$0]++'
}

# Resolve symlinks (macOS /var -> /private/var) on the deepest existing ancestor.
canon() {
  local p="$1" rest="" d
  while [ ! -d "$p" ] && [ "$p" != "/" ]; do rest="/$(basename "$p")$rest"; p="$(dirname "$p")"; done
  d=$(cd -P "$p" 2>/dev/null && pwd) || d="$p"
  printf '%s%s' "${d%/}" "$rest"
}

is_linked_worktree() { [ -f "$1/.git" ]; }

# Map a path to the longest matching worktree of this repo ("" if none/foreign).
worktree_of() {
  local cp cw wt best="" bestlen=0
  cp=$(canon "$1")
  for wt in "${worktrees[@]}"; do
    cw=$(canon "$wt")
    case "$cp" in
      "$cw"|"$cw"/*) if [ ${#cw} -gt "$bestlen" ]; then best="$wt"; bestlen=${#cw}; fi ;;
    esac
  done
  [ -n "$best" ] || return 0
  is_foreign_agent_path "$best" && return 0
  [ -d "$best" ] && printf '%s' "$best"
}

found=()
mutated=0
last_cwd=""
while IFS=$'\t' read -r kind cwd p; do
  case "$kind" in
    M) mutated=1; continue ;;
    C)
      last_cwd="$cwd"
      wt=$(worktree_of "$cwd")
      # A session that merely STARTED in the main checkout has not touched it;
      # only linked worktrees count from cwd alone (main handled below).
      [ -n "$wt" ] && is_linked_worktree "$wt" && found+=("$wt")
      continue ;;
    P) ;;
    *) continue ;;
  esac
  [ -n "$p" ] || continue
  case "$p" in
    "~") p="$home" ;;
    "~"/*) p="$home/${p#\~/}" ;;
  esac
  # Relative targets resolve against the cwd the command ran in.
  case "$p" in /*) ;; *) [ -n "$cwd" ] || continue; p="$cwd/$p" ;; esac
  wt=$(worktree_of "$p")
  [ -n "$wt" ] && found+=("$wt")
done < <(extract_paths)

# Work done from the main checkout itself (relative paths, no cd): if nothing
# else identified a worktree but the session made changes, use its last cwd.
if [ ${#found[@]} -eq 0 ] && [ "$mutated" = 1 ] && [ -n "$last_cwd" ]; then
  wt=$(worktree_of "$last_cwd")
  [ -n "$wt" ] && found+=("$wt")
fi

[ ${#found[@]} -gt 0 ] && printf '%s\n' "${found[@]}" | sort -u
exit 0

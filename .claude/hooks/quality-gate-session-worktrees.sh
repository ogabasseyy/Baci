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

# Candidate paths from the transcript (absolute only; `~` expanded).
extract_paths() {
  jq -r -f "$(dirname "$0")/quality-gate-session-paths.jq" "$transcript" 2>/dev/null | sort -u
}

# Resolve symlinks (macOS /var -> /private/var) on the deepest existing ancestor.
canon() {
  local p="$1" rest="" d
  while [ ! -d "$p" ] && [ "$p" != "/" ]; do rest="/$(basename "$p")$rest"; p="$(dirname "$p")"; done
  d=$(cd -P "$p" 2>/dev/null && pwd) || d="$p"
  printf '%s%s' "${d%/}" "$rest"
}

is_linked_worktree() { [ -f "$1/.git" ]; }

found=()
while IFS= read -r p; do
  [ -n "$p" ] || continue
  from_cwd=0
  case "$p" in
    "CWD"$'\t'*) p="${p#CWD$'\t'}"; from_cwd=1 ;;
  esac
  case "$p" in
    "~") p="$home" ;;
    "~"/*) p="$home/${p#\~/}" ;;
  esac
  case "$p" in /*) ;; *) continue ;; esac
  best=""
  cp=$(canon "$p")
  for wt in "${worktrees[@]}"; do
    cw=$(canon "$wt")
    case "$cp" in
      "$cw"|"$cw"/*) if [ ${#cw} -gt "${bestlen:-0}" ]; then best="$wt"; bestlen=${#cw}; fi ;;
    esac
  done
  bestlen=0
  [ -n "$best" ] || continue
  is_foreign_agent_path "$best" && continue
  [ -d "$best" ] || continue
  if [ "$from_cwd" = 1 ] && ! is_linked_worktree "$best"; then continue; fi
  found+=("$best")
done < <(extract_paths)

[ ${#found[@]} -gt 0 ] && printf '%s\n' "${found[@]}" | sort -u
exit 0

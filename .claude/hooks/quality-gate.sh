#!/bin/bash
# Stop hook: quality gate — blocks Claude from stopping until the checks pass
# for the work THIS session did.
#
#   exit 0 + no JSON      = allow stop
#   exit 0 + JSON block   = prevent stop; Claude continues with the reason
#   stop_hook_active      = prevents infinite retry loops
#
# Which folder is checked: only worktrees this session's transcript shows it
# touched (cd / git -C / shell writes / Edit / Write paths; reading a file does not count) — see
# quality-gate-session-worktrees.sh. Other agents' worktrees are never checked,
# and a session that touched nothing is skipped. Per-worktree checks (changed
# work only, tests -> lint -> typecheck) live in quality-gate-check-worktree.sh.

INPUT=$(cat)
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=quality-gate-foreign.sh
source "$HOOK_DIR/quality-gate-foreign.sh"

# Already fixing from a prior block: let it stop (printf, not echo: backslashes).
if printf '%s\n' "$INPUT" | jq -e '.stop_hook_active == true' >/dev/null 2>&1; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(printf '%s\n' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)}"
TRANSCRIPT=$(printf '%s\n' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
CHECKER="${QUALITY_GATE_CHECK_SCRIPT:-$HOOK_DIR/quality-gate-check-worktree.sh}"

WORKTREES=()
while IFS= read -r wt; do
  [ -n "$wt" ] && WORKTREES+=("$wt")
done < <("$HOOK_DIR/quality-gate-session-worktrees.sh" "$TRANSCRIPT" "$PROJECT_DIR"; echo "rc=$?")
RC=${WORKTREES[${#WORKTREES[@]}-1]:-rc=0}
unset 'WORKTREES[${#WORKTREES[@]}-1]'

# Transcript missing, unreadable, empty or unparsable (rc=3): we cannot tell what
# the session did, so FAIL CLOSED to the worktree the hook started in — but only
# if it belongs to this repo's worktree list and is not another agent's. (A
# session that touched nothing can then be blocked by pre-existing dirt there;
# that is the safer failure.)
if [ "$RC" = "rc=3" ] && [ -d "$PROJECT_DIR" ]; then
  top=$(git -C "$PROJECT_DIR" rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$top" ] && git -C "$PROJECT_DIR" worktree list --porcelain 2>/dev/null | grep -qxF "worktree $top"; then
    is_foreign_agent_path "$top" || WORKTREES=("$top")
  fi
fi

if [ ${#WORKTREES[@]} -eq 0 ]; then
  echo "quality-gate: no worktree touched by this session; skipping checks" >&2
  exit 0
fi

REASONS=""
for wt in "${WORKTREES[@]}"; do
  if ! OUT=$("$CHECKER" "$wt"); then
    REASONS="${REASONS:+$REASONS

}$OUT"
  fi
done

if [ -n "$REASONS" ]; then
  jq -n --arg reason "$REASONS" '{"decision": "block", "reason": $reason}'
fi
exit 0

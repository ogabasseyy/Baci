#!/bin/bash
# Stop hook: Quality gate — blocks Claude from stopping until lint + typecheck + tests pass
# Uses JSON decision control so Claude gets structured context to fix errors
#
# How it works:
#   exit 0 + no JSON      = allow stop (all checks passed)
#   exit 0 + JSON block   = prevent stop, Claude continues with reason as context
#   stop_hook_active check = prevents infinite retry loops

INPUT=$(cat)

# shellcheck source=quality-gate-environment.sh
source "$(dirname "$0")/quality-gate-environment.sh"

# CRITICAL: Prevent infinite loops — if Claude is already fixing from a prior block, let it stop.
# Use `printf '%s\n'` rather than `echo` to feed jq — some echo implementations
# (notably macOS /bin/sh) interpret backslash escapes by default, which would
# corrupt JSON containing escaped quotes/backslashes.
if printf '%s\n' "$INPUT" | jq -e '.stop_hook_active == true' >/dev/null 2>&1; then
  exit 0
fi

# Resolve the active worktree. `$CLAUDE_PROJECT_DIR` is just where the
# session started — not necessarily where the current task lives. Sessions
# routinely spawn isolated worktrees for PR work, and auditing the session
# root surfaces accumulated WIP from other tasks every time the hook fires.
#
# Resolution order:
#   1. `cwd` reported by Claude in the Stop hook input — precise signal of
#      where the session actually is at stop time. Pinned to this session,
#      so a concurrent agent's `git add` in another worktree can't redirect us.
#   2. Most-recently-touched worktree, constrained to a recency window
#      (default 1h, override via QUALITY_GATE_RECENCY_WINDOW). Bounds the
#      multi-agent race to recently-active worktrees only.
#   3. $CLAUDE_PROJECT_DIR — original session root.
#
# Worktree-list and gitdir parsers strip the fixed prefix instead of
# field-splitting on whitespace, so worktree paths containing spaces are
# preserved intact.
ACTIVE_DIR="$CLAUDE_PROJECT_DIR"

# (1) Prefer Claude-reported session cwd, but ONLY when it differs from the
# session root AND resolves to a git worktree top. In current Claude Code,
# `INPUT.cwd` is the session root — the same as $CLAUDE_PROJECT_DIR — even
# when Bash commands have cd'd into a worktree. Trusting cwd in that case
# defeats worktree resolution.
#
# Only trust cwd when it's a different directory (e.g. future Claude Code
# versions that report the agent's actual worktree, or agent SDKs that
# explicitly set it). Otherwise fall through to the mtime scan.
SESSION_CWD=$(printf '%s\n' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
if [ -n "$SESSION_CWD" ] && [ "$SESSION_CWD" != "$CLAUDE_PROJECT_DIR" ] && [ -d "$SESSION_CWD" ]; then
  # Restrict cwd-derived worktree resolution to THIS repository. The agent may
  # have cd'd to an entirely different repo (e.g. cloned a separate project).
  # In that case `git rev-parse --show-toplevel` from cwd succeeds but resolves
  # to an unrelated tree — running the quality gate against another project's
  # state, which could bypass it for Baci changes (if the other repo is clean)
  # or wrongly block on the other project's lint/typecheck/test failures.
  #
  # Resolve WT_TOP from cwd, then verify it appears in $CLAUDE_PROJECT_DIR's
  # `git worktree list`. Same prefix-strip parser used in the mtime scan below
  # — preserves paths with spaces and uses output git already guarantees.
  WT_TOP=$(git -C "$SESSION_CWD" rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$WT_TOP" ]; then
    while IFS= read -r line; do
      case "$line" in
        "worktree $WT_TOP")
          ACTIVE_DIR="$WT_TOP"
          break
          ;;
      esac
    done < <(git -C "$CLAUDE_PROJECT_DIR" worktree list --porcelain 2>/dev/null)
  fi
fi

# (2) Mtime-scan fallback. Runs whenever cwd resolution above didn't yield
# a worktree top — either cwd wasn't set, equaled the session root, wasn't a
# directory, or pointed somewhere outside any git tree (e.g. /tmp). In all of
# those cases ACTIVE_DIR is still $CLAUDE_PROJECT_DIR, and we let the scan
# pick a more specific recently-active worktree if one exists.
if [ "$ACTIVE_DIR" = "$CLAUDE_PROJECT_DIR" ] && command -v git >/dev/null 2>&1; then
  # Two-tier selection:
  #
  # PREFERRED — newest worktree within the recency window. The window bounds
  # the multi-agent race: a concurrent agent's recent `git add` in another
  # worktree won't redirect us if our worktree is fresher than its.
  #
  # FALLBACK — newest worktree overall, ignoring the window. Applies when no
  # worktree qualifies as "recent" — typically a long-running session that
  # has been editing files for hours without running `git add` (the index
  # only updates on staging, not on unstaged edits). Without this fallback,
  # the active worktree would be silently dropped and ACTIVE_DIR would fall
  # back to $CLAUDE_PROJECT_DIR — auditing the wrong tree, which is the
  # exact failure the cwd/mtime resolver is meant to prevent.
  in_window_mtime=0
  in_window_path=""
  overall_mtime=0
  overall_path=""
  now=$(date +%s)
  # Validate QUALITY_GATE_RECENCY_WINDOW is numeric — a non-numeric override
  # would otherwise crash the arithmetic comparison below and fail the hook.
  recency=${QUALITY_GATE_RECENCY_WINDOW:-3600}
  case "$recency" in
    ''|*[!0-9]*) recency=3600 ;;
  esac
  while IFS= read -r line; do
    # Parse `worktree <path>` records. Strip the fixed prefix so paths
    # containing spaces survive intact.
    case "$line" in
      "worktree "*) wt="${line#worktree }" ;;
      *) continue ;;
    esac
    [ -z "$wt" ] && continue
    # Linked worktrees have .git as a FILE pointing to the real gitdir
    # under <main>/.git/worktrees/<name>. The main worktree has .git as a
    # directory. The index lives at <gitdir>/index in both cases.
    if [ -f "$wt/.git" ]; then
      gitdir_line=$(grep '^gitdir:' "$wt/.git" 2>/dev/null | head -1)
      gitdir="${gitdir_line#gitdir: }"
    else
      gitdir="$wt/.git"
    fi
    idx="$gitdir/index"
    [ -f "$idx" ] || continue
    # GNU/Linux uses `stat -c %Y`, macOS uses `stat -f %m`. Order matters:
    #
    # - GNU first: `stat -c %Y` returns mtime cleanly on Linux. On macOS,
    #   `-c` isn't a valid flag — stat errors with usage to stderr (we
    #   silence it), writes nothing usable to stdout, exits non-zero. The
    #   `||` falls through to BSD `stat -f %m` which works there.
    #
    # - The REVERSE order (BSD first) is broken on Linux: GNU `stat -f`
    #   queries FILESYSTEM info, not file info, AND exits 0 with garbage
    #   when given `%m`. The `||` never falls through, every worktree's
    #   mtime is non-numeric, and the recency feature silently degrades to
    #   "all worktrees skipped → fall back to $CLAUDE_PROJECT_DIR" — which
    #   is the exact bug this PR exists to fix.
    #
    # Keep the numeric guard either way as defense in depth.
    mtime=$(stat -c %Y "$idx" 2>/dev/null || stat -f %m "$idx" 2>/dev/null)
    case "$mtime" in
      ''|*[!0-9]*) continue ;;
    esac
    # Track newest overall (used as fallback) AND newest within window
    # (preferred). Both walked in a single pass.
    if [ "$mtime" -gt "$overall_mtime" ]; then
      overall_mtime=$mtime
      overall_path="$wt"
    fi
    if [ $((now - mtime)) -le "$recency" ] && [ "$mtime" -gt "$in_window_mtime" ]; then
      in_window_mtime=$mtime
      in_window_path="$wt"
    fi
  done < <(git -C "$CLAUDE_PROJECT_DIR" worktree list --porcelain 2>/dev/null)
  newest_path="${in_window_path:-$overall_path}"
  [ -n "$newest_path" ] && ACTIVE_DIR="$newest_path"
fi

cd "$ACTIVE_DIR" || exit 0

# Check that new/modified source files have colocated test files.
# Exempt rules live in ci_scripts/quality-gate-missing-tests.sh.
MISSING_TESTS=""
if [ -x "$ACTIVE_DIR/ci_scripts/quality-gate-missing-tests.sh" ]; then
  MISSING_TESTS=$(sh "$ACTIVE_DIR/ci_scripts/quality-gate-missing-tests.sh" || true)
fi

if [ -n "$MISSING_TESTS" ]; then
  jq -n --arg reason "Missing test files for new/modified source files. Create colocated tests:\n$MISSING_TESTS\n\nSee .ruler/07-testing.md for test requirements." \
    '{"decision": "block", "reason": $reason}'
  exit 0
fi

# If node_modules / turbo are missing, lint/typecheck/test can't run. The
# hook's contract is "block stop until quality checks pass" — silently
# exiting here would let real compile/test failures slip past locally
# (codex P1), regardless of whether we're in the main or a linked worktree.
#
# Block by default with an actionable remediation. `QUALITY_GATE_SKIP_DEPS=1`
# is the explicit escape hatch for workflows that intentionally use
# dep-less worktrees (e.g. throwaway worktrees for git ops) and rely on
# the PR's CI to enforce the contract. Setting that env var globally in
# your shell or `~/.claude/settings.json` makes the bypass deliberate
# rather than silent.
if [ ! -d node_modules ] || [ ! -x node_modules/.bin/turbo ]; then
  if [ "${QUALITY_GATE_SKIP_DEPS:-0}" = "1" ]; then
    exit 0
  fi
  sparse_install='.github/scripts/pnpm-install-sparse-worktree.sh --frozen-lockfile'
  if [ -x "$ACTIVE_DIR/ci_scripts/is-dep-less-worktree.sh" ] && sh "$ACTIVE_DIR/ci_scripts/is-dep-less-worktree.sh"; then
    install_hint="Linked worktree: ensure node_modules symlinks to a full install, or run \`$sparse_install\`"
  elif [ -x "$ACTIVE_DIR/ci_scripts/is-sparse-checkout.sh" ] && sh "$ACTIVE_DIR/ci_scripts/is-sparse-checkout.sh"; then
    install_hint="Run \`$sparse_install\` in this sparse worktree"
  else
    install_hint='Run `pnpm install` in this worktree'
  fi
  jq -n --arg reason "node_modules / turbo not installed in $(pwd). Either:
  • ${install_hint}, OR
  • Set QUALITY_GATE_SKIP_DEPS=1 (export it globally if you routinely work in dep-less worktrees and rely on PR CI to enforce the contract)" \
    '{"decision": "block", "reason": $reason}'
  exit 0
fi

# Resolve the turbo command and worktree-aware pnpm configuration via a
# focused helper (keeps this stop hook under the 300-line budget).
TURBO_CMD=()
TURBO_SPARSE_FILTERS=()
if [ -x "$ACTIVE_DIR/ci_scripts/resolve-turbo-cmd.sh" ]; then
  _section=""
  while IFS= read -r -d '' token; do
    case "$token" in
      ---ENV---) _section=env ;;
      ---TURBO_CMD---) _section=cmd ;;
      ---FILTERS---) _section=filters ;;
      *)
        if [ "$_section" = "env" ]; then
          export "${token?}"
        elif [ "$_section" = "cmd" ]; then TURBO_CMD+=("$token")
        elif [ "$_section" = "filters" ]; then TURBO_SPARSE_FILTERS+=("$token")
        fi ;;
    esac
  done < <(ACTIVE_DIR="$ACTIVE_DIR" bash "$ACTIVE_DIR/ci_scripts/resolve-turbo-cmd.sh")
fi
if [ ${#TURBO_CMD[@]} -eq 0 ]; then
  TURBO_CMD=(pnpm turbo)
fi

# Run Biome lint check (~2-5s)
LINT_RESULT=$("${TURBO_CMD[@]}" lint "${TURBO_SPARSE_FILTERS[@]}" 2>&1)
LINT_EXIT=$?

if [ $LINT_EXIT -ne 0 ]; then
  TRIMMED=$(echo "$LINT_RESULT" | tail -30)
  jq -n --arg reason "Lint errors detected. Fix all lint errors before completing:\n\n$TRIMMED" \
    '{"decision": "block", "reason": $reason}'
  exit 0
fi

# Run TypeScript type check (~10-30s)
TYPE_RESULT=$("${TURBO_CMD[@]}" typecheck "${TURBO_SPARSE_FILTERS[@]}" 2>&1)
TYPE_EXIT=$?

if [ $TYPE_EXIT -ne 0 ]; then
  if echo "$TYPE_RESULT" | grep -q 'Command "turbo" not found'; then
    jq -n --arg reason "Cannot run typecheck: turbo is not installed in $(pwd). Run \`pnpm install\` in this worktree (or set QUALITY_GATE_SKIP_DEPS=1 if you rely on CI)." \
      '{"decision": "block", "reason": $reason}'
    exit 0
  fi
  if echo "$TYPE_RESULT" | grep -q 'You can learn about all of the compiler options'; then
    jq -n --arg reason "Typecheck failed because a workspace package is missing tsconfig.json (common in sparse worktrees). Expand sparse checkout, work from a full worktree, or rely on PR CI with QUALITY_GATE_SKIP_DEPS=1." \
      '{"decision": "block", "reason": $reason}'
    exit 0
  fi
  TRIMMED=$(echo "$TYPE_RESULT" | tail -30)
  jq -n --arg reason "TypeScript errors detected. Fix all type errors before completing:\n\n$TRIMMED" \
    '{"decision": "block", "reason": $reason}'
  exit 0
fi

# Run tests (~5-30s)
TEST_RESULT=$("${TURBO_CMD[@]}" test "${TURBO_SPARSE_FILTERS[@]}" 2>&1)
TEST_EXIT=$?

if [ $TEST_EXIT -ne 0 ]; then
  TRIMMED=$(echo "$TEST_RESULT" | tail -30)
  jq -n --arg reason "Tests failed. Fix all failing tests before completing:\n\n$TRIMMED" \
    '{"decision": "block", "reason": $reason}'
  exit 0
fi

# Run CodeRabbit AI code review on uncommitted changes (~5-15s)
# Fail-open: if CodeRabbit itself crashes (OOM, network, auth), let the stop proceed.
# --agent streams JSON events and ends with {"type":"complete",...,"findings":N};
# block only when that completion event reports findings > 0. (The old
# --prompt-only flag was removed from the CLI and made every run print an
# "unknown option" error that false-triggered the block regex.)
if command -v coderabbit >/dev/null 2>&1; then
  CR_RESULT=$(coderabbit review --agent -t uncommitted 2>&1) || true

  # Parse the NDJSON event stream with jq (tolerates key order, whitespace,
  # and non-JSON warning lines) instead of a key-order-sensitive grep.
  CR_FINDINGS=$(echo "$CR_RESULT" | jq -Rr 'fromjson? | select(.type == "complete") | .findings // empty' 2>/dev/null | tail -1)
  if ! [ "$CR_FINDINGS" -ge 0 ] 2>/dev/null; then
    : # No numeric completion event — CLI error, OOM, network, auth. Fail-open, allow stop.
  elif [ "$CR_FINDINGS" -gt 0 ]; then
    TRIMMED=$(echo "$CR_RESULT" | grep '"type":"finding"' | tail -30)
    [ -n "$TRIMMED" ] || TRIMMED=$(echo "$CR_RESULT" | tail -30)
    jq -n --arg reason "CodeRabbit found $CR_FINDINGS issue(s) in your changes. Review and fix:\n\n$TRIMMED" \
      '{"decision": "block", "reason": $reason}'
    exit 0
  fi
fi

# All checks pass — allow Claude to stop
exit 0

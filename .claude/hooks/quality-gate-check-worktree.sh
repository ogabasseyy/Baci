#!/bin/bash
# Runs the quality checks for ONE worktree. Called by quality-gate.sh.
#
# Usage: quality-gate-check-worktree.sh <worktree_dir>
# Exit 0  = passed or skipped (skip reasons go to stderr)
# Exit 1  = blocked; the block reason is printed on stdout
#
# Checks only what changed: skipped entirely when the worktree has no
# uncommitted changes and no commits beyond origin/main; turbo runs with
# --affected against the merge-base so unrelated packages are not checked.
# Order is tests -> lint -> typecheck, strictly sequential (never in parallel),
# so lint never races a test run that is still creating scratch files.

ACTIVE_DIR="${1:-}"
[ -d "$ACTIVE_DIR" ] || exit 0
cd "$ACTIVE_DIR" || exit 0

# shellcheck source=quality-gate-environment.sh
source "$(dirname "$0")/quality-gate-environment.sh"

block() { printf '%s\n' "$1"; exit 1; }

# --- Is there anything of this worktree's own to check? -----------------
# If the merge-base cannot be computed (no origin/main), do NOT skip: run the
# full checks without --affected.
BASE=$(git merge-base HEAD origin/main 2>/dev/null)
DIRTY=$(git status --porcelain 2>/dev/null | head -1)
if [ -n "$BASE" ]; then
  AHEAD=$(git rev-list --count "$BASE"..HEAD 2>/dev/null || echo 0)
  if [ -z "$DIRTY" ] && [ "${AHEAD:-0}" = "0" ]; then
    echo "quality-gate: skipped $ACTIVE_DIR (no uncommitted changes, nothing ahead of origin/main)" >&2
    exit 0
  fi
fi

# Colocated tests for new/modified source files.
MISSING_TESTS=""
if [ -x "$ACTIVE_DIR/ci_scripts/quality-gate-missing-tests.sh" ]; then
  MISSING_TESTS=$(sh "$ACTIVE_DIR/ci_scripts/quality-gate-missing-tests.sh" || true)
fi
if [ -n "$MISSING_TESTS" ]; then
  block "Missing test files for new/modified source files in $ACTIVE_DIR. Create colocated tests:
$MISSING_TESTS

See .ruler/07-testing.md for test requirements."
fi

# Without installed dependencies nothing can run. This worktree is the
# session's own, so block with a fix-it hint (silently passing would let real
# failures slip). QUALITY_GATE_SKIP_DEPS=1 is the deliberate escape hatch for
# dep-less worktrees that rely on PR CI.
if [ ! -d node_modules ] || [ ! -x node_modules/.bin/turbo ]; then
  if [ "${QUALITY_GATE_SKIP_DEPS:-0}" = "1" ]; then
    echo "quality-gate: skipped $ACTIVE_DIR (no node_modules; QUALITY_GATE_SKIP_DEPS=1)" >&2
    exit 0
  fi
  sparse_install='.github/scripts/pnpm-install-sparse-worktree.sh --frozen-lockfile'
  if [ -x "$ACTIVE_DIR/ci_scripts/is-dep-less-worktree.sh" ] && sh "$ACTIVE_DIR/ci_scripts/is-dep-less-worktree.sh"; then
    install_hint="Linked worktree: ensure node_modules symlinks to a full install, or run \`$sparse_install\`"
  elif [ -x "$ACTIVE_DIR/ci_scripts/is-sparse-checkout.sh" ] && sh "$ACTIVE_DIR/ci_scripts/is-sparse-checkout.sh"; then
    install_hint="Run \`$sparse_install\` in this sparse worktree"
  else
    install_hint="Run \`pnpm install\` in this worktree"
  fi
  block "node_modules / turbo not installed in $ACTIVE_DIR. Either:
  • ${install_hint}, OR
  • Set QUALITY_GATE_SKIP_DEPS=1 (export it globally if you routinely work in dep-less worktrees and rely on PR CI to enforce the contract)"
fi

# Turbo command + worktree-aware pnpm configuration.
TURBO_CMD=()
TURBO_SPARSE_FILTERS=()
if [ -x "$ACTIVE_DIR/ci_scripts/resolve-turbo-cmd.sh" ]; then
  _section=""
  while IFS= read -r -d '' token; do
    case "$token" in
      "---ENV---") _section="env" ;;
      "---TURBO_CMD---") _section=cmd ;;
      "---FILTERS---") _section=filters ;;
      *)
        if [ "$_section" = "env" ]; then
          export "${token?}"
        elif [ "$_section" = "cmd" ]; then TURBO_CMD+=("$token")
        elif [ "$_section" = "filters" ]; then TURBO_SPARSE_FILTERS+=("$token")
        fi ;;
    esac
  done < <(export ACTIVE_DIR; bash "$ACTIVE_DIR/ci_scripts/resolve-turbo-cmd.sh")
fi
[ ${#TURBO_CMD[@]} -gt 0 ] || TURBO_CMD=(pnpm turbo)

AFFECTED=()
if [ -n "$BASE" ]; then
  export TURBO_SCM_BASE="$BASE"
  AFFECTED=(--affected)
fi

run_turbo() { "${TURBO_CMD[@]}" "$1" "${AFFECTED[@]}" "${TURBO_SPARSE_FILTERS[@]}" 2>&1; }

# 1. Tests (before lint: test scratch files must be gone by the time lint runs)
TEST_RESULT=$(run_turbo test) || block "Tests failed in $ACTIVE_DIR. Fix all failing tests before completing:

$(echo "$TEST_RESULT" | tail -30)"

# 2. Lint
LINT_RESULT=$(run_turbo lint) || block "Lint errors detected in $ACTIVE_DIR. Fix all lint errors before completing:

$(echo "$LINT_RESULT" | tail -30)"

# 3. Typecheck
if ! TYPE_RESULT=$(run_turbo typecheck); then
  if echo "$TYPE_RESULT" | grep -q 'Command "turbo" not found'; then
    block "Cannot run typecheck: turbo is not installed in $ACTIVE_DIR. Run \`pnpm install\` there."
  fi
  if echo "$TYPE_RESULT" | grep -q 'You can learn about all of the compiler options'; then
    block "Typecheck failed because a workspace package is missing tsconfig.json (common in sparse worktrees). Expand sparse checkout or rely on PR CI."
  fi
  block "TypeScript errors detected in $ACTIVE_DIR. Fix all type errors before completing:

$(echo "$TYPE_RESULT" | tail -30)"
fi

# 4. CodeRabbit on uncommitted + committed-ahead changes. Fail-open: if it crashes, allow stop.
if { [ -n "$DIRTY" ] || [ "${AHEAD:-0}" != "0" ]; } && command -v coderabbit >/dev/null 2>&1; then
  CR_SCOPE=(--uncommitted)
  [ "${AHEAD:-0}" != "0" ] && CR_SCOPE=(--base-commit "$BASE")
  CR_RESULT=$(coderabbit review --agent "${CR_SCOPE[@]}" --include-untracked 2>&1) || true
  CR_FINDINGS=$(echo "$CR_RESULT" | jq -Rr 'fromjson? | select(.type == "complete") | .findings // empty' 2>/dev/null | tail -1)
  if [ "$CR_FINDINGS" -gt 0 ] 2>/dev/null; then
    TRIMMED=$(echo "$CR_RESULT" | grep '"type":"finding"' | tail -30)
    [ -n "$TRIMMED" ] || TRIMMED=$(echo "$CR_RESULT" | tail -30)
    block "CodeRabbit found $CR_FINDINGS issue(s) in your changes in $ACTIVE_DIR. Review and fix:

$TRIMMED"
  fi
fi

exit 0

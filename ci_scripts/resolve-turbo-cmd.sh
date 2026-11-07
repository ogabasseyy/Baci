#!/bin/bash
# Resolves the turbo command and pnpm worktree configuration for quality-gate.sh.
# Prints NUL-delimited tokens. Sections:
#   ---ENV---      KEY=VALUE pairs the caller must export in its own process
#   ---TURBO_CMD--- turbo command argv parts
#   ---FILTERS---   sparse-exclude filter arguments, plus --affected when scoped
#
# Local runs are scoped to packages changed since the origin/main merge base
# (TURBO_SCM_BASE + --affected) unless QUALITY_GATE_FULL=1 or no base is found.
#
# Environment on entry:
#   ACTIVE_DIR        — resolved worktree root (required)
#   PNPM              — (optional) path to pnpm wrapper; falls back to `pnpm`
#   QUALITY_GATE_FULL — (optional) set to 1 to force the full, unscoped gate
set -euo pipefail

ACTIVE_DIR="${ACTIVE_DIR:?ACTIVE_DIR must be set}"

PNPM_CMD="${PNPM:-}"
if [ -z "$PNPM_CMD" ]; then
  PNPM_SCRIPT="$ACTIVE_DIR/ci_scripts/run-lefthook-pnpm.sh"
  if [ -x "$PNPM_SCRIPT" ]; then
    PNPM_CMD="bash $PNPM_SCRIPT"
  else
    PNPM_CMD="pnpm"
  fi
fi

ENV_TOKENS=()
if [ -x "$ACTIVE_DIR/ci_scripts/is-dep-less-worktree.sh" ] && sh "$ACTIVE_DIR/ci_scripts/is-dep-less-worktree.sh"; then
  ENV_TOKENS+=(
    "PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false"
    "PNPM_CONFIG_ALLOW_UNUSED_PATCHES=true"
    "BACI_REAL_PNPM=${BACI_REAL_PNPM:-$(command -v pnpm)}"
    "PATH=$ACTIVE_DIR/ci_scripts/hook-bin:$PATH"
  )
fi

# Empty output means "run the full gate" (fail safe). The script is invoked
# through `sh`, so a checkout that predates it simply stays unscoped.
AFFECTED_BASE=""
if [ -f "$ACTIVE_DIR/ci_scripts/quality-gate-affected-base.sh" ]; then
  AFFECTED_BASE=$(sh "$ACTIVE_DIR/ci_scripts/quality-gate-affected-base.sh" "$ACTIVE_DIR" 2>/dev/null || true)
fi
if [ -n "$AFFECTED_BASE" ]; then
  ENV_TOKENS+=("TURBO_SCM_BASE=$AFFECTED_BASE")
fi

TURBO_SPARSE_FILTERS=()
if [ -x "$ACTIVE_DIR/ci_scripts/turbo-sparse-exclude-filters.sh" ]; then
  while IFS= read -r -d '' filter; do
    TURBO_SPARSE_FILTERS+=("$filter")
  done < <(sh "$ACTIVE_DIR/ci_scripts/turbo-sparse-exclude-filters.sh")
fi

# Prefer the worktree-local turbo binary. `pnpm turbo` can re-trigger install /
# deps-status checks in sparse worktrees even when node_modules/.bin/turbo exists.
TURBO_CMD=($PNPM_CMD turbo)
if [ -x "$ACTIVE_DIR/node_modules/.bin/turbo" ]; then
  TURBO_CMD=("$ACTIVE_DIR/node_modules/.bin/turbo")
fi

printf '%s\0' "---ENV---"
if [ ${#ENV_TOKENS[@]} -gt 0 ]; then
  printf '%s\0' "${ENV_TOKENS[@]}"
fi
printf '%s\0' "---TURBO_CMD---"
printf '%s\0' "${TURBO_CMD[@]}"
printf '%s\0' "---FILTERS---"
if [ ${#TURBO_SPARSE_FILTERS[@]} -gt 0 ]; then
  printf '%s\0' "${TURBO_SPARSE_FILTERS[@]}"
fi
if [ -n "$AFFECTED_BASE" ]; then
  printf '%s\0' "--affected"
fi

#!/bin/bash
# Resolves the turbo command and pnpm worktree configuration for quality-gate.sh.
# Prints NUL-delimited tokens. Sections:
#   ---ENV---      KEY=VALUE pairs the caller must export in its own process
#   ---TURBO_CMD--- turbo command argv parts
#   ---FILTERS---   sparse-exclude filter arguments
#
# Environment on entry:
#   ACTIVE_DIR — resolved worktree root (required)
#   PNPM       — (optional) path to pnpm wrapper; falls back to `pnpm`
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

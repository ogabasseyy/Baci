#!/usr/bin/env bash
# Sourced by quality-gate.sh (needs ROOT and HOOK_DIR). Scopes the gate to
# packages changed since the origin/main merge base. Empty helper output
# (QUALITY_GATE_FULL=1, no origin/main, no merge base) or a missing helper
# leaves AFFECTED_ARGS empty, so the full gate runs.

AFFECTED_ARGS=()
for affected_base_script in \
  "$ROOT/ci_scripts/quality-gate-affected-base.sh" \
  "$HOOK_DIR/../../ci_scripts/quality-gate-affected-base.sh"; do
  [ -f "$affected_base_script" ] || continue
  affected_base=$(sh "$affected_base_script" "$ROOT" 2>/dev/null || true)
  if [ -n "$affected_base" ]; then
    export TURBO_SCM_BASE="$affected_base"
    AFFECTED_ARGS=(--affected)
  fi
  break
done

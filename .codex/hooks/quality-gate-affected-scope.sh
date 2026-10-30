#!/usr/bin/env bash
# Sourced by quality-gate.sh (needs ROOT). Scopes the gate to packages
# changed since the origin/main merge base, using only this checkout's own
# helper. Empty helper output (QUALITY_GATE_FULL=1, no origin/main, no merge
# base) or a checkout without the helper leaves AFFECTED_ARGS empty, so the
# full gate runs.

AFFECTED_ARGS=()
affected_base_script="$ROOT/ci_scripts/quality-gate-affected-base.sh"
if [ -f "$affected_base_script" ]; then
  affected_base=$(sh "$affected_base_script" "$ROOT" 2>/dev/null || true)
  if [ -n "$affected_base" ]; then
    export TURBO_SCM_BASE="$affected_base"
    AFFECTED_ARGS=(--affected)
  fi
fi

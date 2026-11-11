#!/bin/bash
# Sourced by quality-gate.sh and quality-gate-session-worktrees.sh.
# is_foreign_agent_path <path>: true when the path belongs to ANOTHER agent's
# checkout, which the gate must never audit. Defaults cover Codex; extend with
# QUALITY_GATE_FOREIGN_PREFIXES (colon-separated absolute prefixes).
is_foreign_agent_path() {
  local pre home="${HOME:-}"
  case "$1" in
    "$home"/.codex/*|"$home"/Documents/Codex/*) return 0 ;;
  esac
  local IFS=:
  for pre in ${QUALITY_GATE_FOREIGN_PREFIXES:-}; do
    [ -n "$pre" ] && case "$1" in "$pre"|"$pre"/*) return 0 ;; esac
  done
  return 1
}

#!/usr/bin/env bash
# Single-shard runner for the reviewer-hardening suite: sources one
# part file so CI can run the four parts as parallel matrix jobs
# instead of one serial process (each case re-audits the whole
# tree, so wall time scales with case count per process).
# O/PR live in the lib, so parts run standalone here.
#
# Usage: bash semgrep-sarif-hardening-shard.test.sh N   (N = 1..4)
# shellcheck source=semgrep-sarif-test-lib.sh disable=SC2154
. "$(dirname "$0")/semgrep-sarif-test-lib.sh"
case "${1:-}" in
  1|2|3|4) ;;
  *) echo "usage: $0 N  (N = 1..4)" >&2; exit 2;;
esac
. "$(dirname "$0")/semgrep-sarif-hardening-part$1.test.sh"

printf '\nhardening shard %s: %d passed, %d failed%s\n' "$1" "$pass" "$fail" "${fail_names:+ ($fail_names)}"
[[ "$fail" -eq 0 ]]

#!/usr/bin/env bash
# Regression suite for the reviewer-hardening rules: quoted YAML keys,
# every-runner-consumer, deferred execution, indirect invocation,
# data-program (perl/jq) content, trusted signals, and base execution.
# Cases live in semgrep-sarif-hardening-partN.test.sh (300-line cap);
# this entrypoint sources them in order and reports the totals.
# Harness lives in semgrep-sarif-test-lib.sh (sourced).
#
# Usage: bash semgrep-sarif-hardening.test.sh   (from any directory)
# shellcheck source=semgrep-sarif-test-lib.sh disable=SC2154,SC2034 # O/PR consumed by sourced parts
. "$(dirname "$0")/semgrep-sarif-test-lib.sh"
O='.github/scripts/muse-review/post.sh'
PR='.github/scripts/muse-review/prompt.sh'
. "$(dirname "$0")/semgrep-sarif-hardening-part1.test.sh"
. "$(dirname "$0")/semgrep-sarif-hardening-part2.test.sh"
. "$(dirname "$0")/semgrep-sarif-hardening-part3.test.sh"
. "$(dirname "$0")/semgrep-sarif-hardening-part4.test.sh"

printf '\nhardening suite: %d passed, %d failed%s\n' "$pass" "$fail" "${fail_names:+ ($fail_names)}"
[[ "$fail" -eq 0 ]]

#!/usr/bin/env bash
set -uo pipefail

terminal_only=false
if [[ "${1:-}" == "--terminal" ]]; then
  terminal_only=true
  shift
fi

if (( $# > 0 )); then
  required_checks=("$@")
else
  required_checks=(
    'Selftest (muse-review)'
    'Selftest (filter)'
    'Selftest (hard-1)'
    'Selftest (hard-2)'
    'Selftest (hard-3)'
    'Selftest (hard-4)'
    'Selftest (static)'
  )
fi
checks="$(cat)"
latest_checks="$(awk -F '\t' '
  NF >= 6 && $1 != "" && $5 != "" {
    # Recency is the check-run id: GitHub assigns increasing ids, so the
    # highest id is always the newest run — including a queued run that
    # has no timestamps yet. (Timestamp strings would sort above a bare
    # id, letting an older success mask a pending latest run.) A newest
    # run without a success conclusion is reported missing below.
    if (!($1 in run_id) || ($5 + 0) > (run_id[$1] + 0)) {
      run_id[$1] = $5
      conclusion[$1] = $6
      completed_at[$1] = $4
    }
  }
  END {
    for (name in run_id) print name "\t" conclusion[name] "\t" completed_at[name]
  }
' <<<"${checks}")"
missing=()
for expected in "${required_checks[@]}"; do
  if ! awk -F '\t' -v expected="${expected}" -v terminal_only="${terminal_only}" \
    '$1 == expected && (terminal_only == "true" ? ($2 != "" && $3 != "") : $2 == "success") { found = 1 } END { exit !found }' \
    <<<"${latest_checks}"; then
    missing+=("${expected}")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'Missing successful checks: %s\n' "${missing[*]}" >&2
  exit 1
fi

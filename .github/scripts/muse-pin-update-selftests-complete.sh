#!/usr/bin/env bash
set -uo pipefail

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
  NF >= 6 && $1 != "" {
    order = $3 != "" ? $3 : ($2 != "" ? $2 : $4)
    if (order != "" && (!($1 in stamp) || order > stamp[$1] ||
        (order == stamp[$1] && ($5 + 0) > (run_id[$1] + 0)))) {
      stamp[$1] = order
      run_id[$1] = $5
      conclusion[$1] = $6
    }
  }
  END {
    for (name in stamp) print name "\t" conclusion[name]
  }
' <<<"${checks}")"
missing=()
for expected in "${required_checks[@]}"; do
  if ! awk -F '\t' -v expected="${expected}" \
    '$1 == expected && $2 == "success" { found = 1 } END { exit !found }' \
    <<<"${latest_checks}"; then
    missing+=("${expected}")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'Missing successful checks: %s\n' "${missing[*]}" >&2
  exit 1
fi

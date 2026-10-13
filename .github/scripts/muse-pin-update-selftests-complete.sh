#!/usr/bin/env bash
set -uo pipefail

required_checks=(
  'Selftest (muse-review)'
  'Selftest (filter)'
  'Selftest (hard-1)'
  'Selftest (hard-2)'
  'Selftest (hard-3)'
  'Selftest (hard-4)'
  'Selftest (static)'
)
checks="$(cat)"
latest_checks="$(awk -F '\t' '
  NF >= 4 && $1 != "" && $2 != "" {
    if (!($1 in stamp) || $2 > stamp[$1] ||
        ($2 == stamp[$1] && ($3 + 0) > (run_id[$1] + 0))) {
      stamp[$1] = $2
      run_id[$1] = $3
      conclusion[$1] = $4
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
  printf 'Missing Muse self-test checks: %s\n' "${missing[*]}" >&2
  exit 1
fi

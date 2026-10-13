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
missing=()
for expected in "${required_checks[@]}"; do
  if ! awk -F '\t' -v expected="${expected}" \
    '$1 == expected && $2 == "success" { found = 1 } END { exit !found }' \
    <<<"${checks}"; then
    missing+=("${expected}")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'Missing Muse self-test checks: %s\n' "${missing[*]}" >&2
  exit 1
fi

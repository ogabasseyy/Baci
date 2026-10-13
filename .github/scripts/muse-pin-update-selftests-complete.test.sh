#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
checker="${script_dir}/muse-pin-update-selftests-complete.sh"
required_checks=(
  'Selftest (muse-review)'
  'Selftest (filter)'
  'Selftest (hard-1)'
  'Selftest (hard-2)'
  'Selftest (hard-3)'
  'Selftest (hard-4)'
  'Selftest (static)'
)
complete_checks=''
for check in "${required_checks[@]}"; do
  complete_checks+="${check}"$'\tsuccess\n'
done

if ! printf '%s\n' "${complete_checks}" | bash "${checker}"; then
  echo 'FAIL complete self-test matrix rejected.' >&2
  exit 1
fi

for missing_check in "${required_checks[@]}"; do
  incomplete_checks=''
  while IFS=$'\t' read -r check conclusion; do
    if [[ "${check}" != "${missing_check}" ]]; then
      incomplete_checks+="${check}"$'\t'"${conclusion}"$'\n'
    fi
  done <<<"${complete_checks}"
  if printf '%s' "${incomplete_checks}" | bash "${checker}" >/dev/null 2>&1; then
    echo "FAIL missing check was accepted: ${missing_check}" >&2
    exit 1
  fi
done

# A similar prefix must never stand in for a missing matrix shard.
prefixed_checks=''
for check in "${required_checks[@]}"; do
  if [[ "${check}" == 'Selftest (hard-2)' ]]; then
    prefixed_checks+='Selftest (hard-20)'$'\tsuccess\n'
  else
    prefixed_checks+="${check}"$'\tsuccess\n'
  fi
done
if printf '%s\n' "${prefixed_checks}" | bash "${checker}" >/dev/null 2>&1; then
  echo 'FAIL accepted a prefixed but absent matrix check.' >&2
  exit 1
fi

for failed_conclusion in cancelled timed_out stale failure action_required skipped; do
  incomplete_checks="${complete_checks/$(printf '%s\tsuccess' 'Selftest (hard-2)')/$(printf '%s\t%s' 'Selftest (hard-2)' "${failed_conclusion}")}"
  if printf '%s' "${incomplete_checks}" | bash "${checker}" >/dev/null 2>&1; then
    echo "FAIL accepted incomplete self-test conclusion: ${failed_conclusion}" >&2
    exit 1
  fi
done

printf 'Muse self-test matrix checks passed.\n'

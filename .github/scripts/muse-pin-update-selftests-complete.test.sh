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
timestamp='2026-10-13T10:00:00Z'
run_id=1
for check in "${required_checks[@]}"; do
  complete_checks+="${check}"$'\t'"${timestamp}"$'\t'"${run_id}"$'\tsuccess\n'
  run_id=$(( run_id + 1 ))
done

if ! printf '%s\n' "${complete_checks}" | bash "${checker}"; then
  echo 'FAIL complete self-test matrix rejected.' >&2
  exit 1
fi

for missing_check in "${required_checks[@]}"; do
  incomplete_checks=''
  while IFS=$'\t' read -r check run_timestamp check_run_id conclusion; do
    if [[ "${check}" != "${missing_check}" ]]; then
      incomplete_checks+="${check}"$'\t'"${run_timestamp}"$'\t'"${check_run_id}"$'\t'"${conclusion}"$'\n'
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
    prefixed_checks+='Selftest (hard-20)'$'\t'"${timestamp}"$'\t999\tsuccess\n'
  else
    prefixed_checks+="${check}"$'\t'"${timestamp}"$'\t'"${run_id}"$'\tsuccess\n'
  fi
  run_id=$(( run_id + 1 ))
done
if printf '%s\n' "${prefixed_checks}" | bash "${checker}" >/dev/null 2>&1; then
  echo 'FAIL accepted a prefixed but absent matrix check.' >&2
  exit 1
fi

for failed_conclusion in cancelled timed_out stale failure action_required skipped; do
  incomplete_checks="${complete_checks/$(printf '%s\t%s\t%s\tsuccess' 'Selftest (hard-2)' "${timestamp}" 4)/$(printf '%s\t%s\t%s\t%s' 'Selftest (hard-2)' "${timestamp}" 4 "${failed_conclusion}")}"
  if printf '%s' "${incomplete_checks}" | bash "${checker}" >/dev/null 2>&1; then
    echo "FAIL accepted incomplete self-test conclusion: ${failed_conclusion}" >&2
    exit 1
  fi
done

older_success_then_latest_failure="${complete_checks}Selftest (hard-2)\t2026-10-13T09:00:00Z\t100\tsuccess\nSelftest (hard-2)\t2026-10-13T11:00:00Z\t101\tcancelled\n"
if printf '%b' "${older_success_then_latest_failure}" | bash "${checker}" >/dev/null 2>&1; then
  echo 'FAIL accepted an older success over a newer canceled self-test.' >&2
  exit 1
fi

older_failure_then_latest_success="${complete_checks}Selftest (hard-2)\t2026-10-13T09:00:00Z\t100\tcancelled\nSelftest (hard-2)\t2026-10-13T11:00:00Z\t101\tsuccess\n"
if ! printf '%b' "${older_failure_then_latest_success}" | bash "${checker}"; then
  echo 'FAIL rejected a successful latest self-test after an older canceled run.' >&2
  exit 1
fi

printf 'Muse self-test matrix checks passed.\n'

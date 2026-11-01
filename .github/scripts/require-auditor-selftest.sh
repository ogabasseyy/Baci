#!/usr/bin/env bash
set -euo pipefail

if [[ "${AUDITOR_SELFTEST_RESULT:-}" != "success" ]]; then
  echo "Auditor selftest did not pass: ${AUDITOR_SELFTEST_RESULT:-}"
  exit 1
fi

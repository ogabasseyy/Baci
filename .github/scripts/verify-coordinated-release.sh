#!/usr/bin/env bash
set -euo pipefail

expected="${EXPECTED_RELEASE_SHA:-}"
if [ "${GITHUB_EVENT_NAME:-}" = "workflow_dispatch" ] && { [ -z "${COORDINATION_ID:-}" ] || [ -z "$expected" ]; }; then
  echo 'Uncoordinated manual dispatch; production work requires coordinator identifiers.' >&2
  exit 1
fi
if [ -n "${COORDINATION_ID:-}" ] || [ -n "$expected" ]; then
  if [[ ! "$expected" =~ ^[a-f0-9]{40}$ ]] || [ "$expected" != "${GITHUB_SHA:-}" ]; then
    echo 'Coordinated release SHA mismatch; refusing production work.' >&2
    exit 1
  fi
fi

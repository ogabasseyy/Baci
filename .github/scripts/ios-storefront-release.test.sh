#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$script_dir/ios-storefront-release.sh"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

env_file="$fixture_root/env"
output_file="$fixture_root/output"
GH_EVENT_NAME=workflow_dispatch \
GH_REF_TYPE=branch \
GH_REF_NAME=main \
GH_RUN_NUMBER=4 \
INPUT_BUILD_NUMBER=7 \
BUILD_NUMBER_BASE=30 \
APP_VERSION_MAJOR_MINOR=2.1 \
GITHUB_ENV="$env_file" \
GITHUB_OUTPUT="$output_file" \
bash "$script" resolve-build
grep -q '^IOS_BUILD_NUMBER=7$' "$env_file"
grep -q '^IOS_APP_VERSION=2.1.7$' "$env_file"
grep -q '^build_number=7$' "$output_file"

if GH_EVENT_NAME=workflow_dispatch \
  GH_REF_TYPE=branch \
  GH_REF_NAME=main \
  GH_RUN_NUMBER=4 \
  INPUT_BUILD_NUMBER=7 \
  BUILD_NUMBER_BASE=30 \
  APP_VERSION_MAJOR_MINOR=2 \
  GITHUB_ENV="$fixture_root/invalid-env" \
  GITHUB_OUTPUT="$fixture_root/invalid-output" \
  bash "$script" resolve-build >"$fixture_root/invalid-log" 2>&1; then
  echo 'Expected invalid app version to fail' >&2
  exit 1
fi
grep -q 'Invalid APP_VERSION_MAJOR_MINOR' "$fixture_root/invalid-log"

if bash "$script" unknown >"$fixture_root/unknown-log" 2>&1; then
  echo 'Expected an unknown operation to fail' >&2
  exit 1
fi
grep -q 'Unknown iOS storefront release operation' "$fixture_root/unknown-log"

echo 'iOS storefront release script checks passed'

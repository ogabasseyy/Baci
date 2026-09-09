#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$script_dir/android-storefront-release.sh"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

env_file="$fixture_root/env"
output_file="$fixture_root/output"
GH_EVENT_NAME=workflow_dispatch \
GH_REF_TYPE=branch \
GH_REF_NAME=main \
GH_RUN_NUMBER=4 \
VERSION_CODE_INPUT=42 \
VERSION_CODE_BASE=10 \
GITHUB_ENV="$env_file" \
GITHUB_OUTPUT="$output_file" \
bash "$script" resolve-version
grep -q '^VERSION_CODE=42$' "$env_file"
grep -q '^version_code=42$' "$output_file"

if GH_EVENT_NAME=workflow_dispatch \
  GH_REF_TYPE=branch \
  GH_REF_NAME=main \
  GH_RUN_NUMBER=4 \
  VERSION_CODE_INPUT=invalid \
  VERSION_CODE_BASE=10 \
  GITHUB_ENV="$fixture_root/invalid-env" \
  GITHUB_OUTPUT="$fixture_root/invalid-output" \
  bash "$script" resolve-version >"$fixture_root/invalid-log" 2>&1; then
  echo 'Expected invalid version code to fail' >&2
  exit 1
fi
grep -q 'Invalid version code' "$fixture_root/invalid-log"

if bash "$script" unknown >"$fixture_root/unknown-log" 2>&1; then
  echo 'Expected an unknown operation to fail' >&2
  exit 1
fi
grep -q 'Unknown Android storefront release operation' "$fixture_root/unknown-log"
grep -q 'app:bundleRelease -PreactNativeArchitectures=arm64-v8a' "$script"

echo 'Android storefront release script checks passed'

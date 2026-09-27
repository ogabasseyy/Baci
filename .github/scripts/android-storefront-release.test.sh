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

sdk_root="$fixture_root/sdk"
mkdir -p "$sdk_root/cmdline-tools/20.0/bin"
touch "$sdk_root/cmdline-tools/20.0/bin/sdkmanager"
chmod +x "$sdk_root/cmdline-tools/20.0/bin/sdkmanager"
ANDROID_HOME="$sdk_root" bash "$script" link-cmdline-tools-latest
[ -x "$sdk_root/cmdline-tools/latest/bin/sdkmanager" ]

ANDROID_HOME="$sdk_root" bash "$script" link-cmdline-tools-latest
[ -x "$sdk_root/cmdline-tools/latest/bin/sdkmanager" ]

empty_root="$fixture_root/empty-sdk"
mkdir -p "$empty_root/cmdline-tools"
if ANDROID_HOME="$empty_root" bash "$script" link-cmdline-tools-latest >"$fixture_root/link-log" 2>&1; then
  echo 'Expected missing sdkmanager to fail' >&2
  exit 1
fi
grep -q 'No sdkmanager' "$fixture_root/link-log"

# A non-executable sdkmanager must never win over an executable one, even when
# filesystem order lists it first.
mixed_root="$fixture_root/mixed-sdk"
mkdir -p "$mixed_root/cmdline-tools/10.0/bin" "$mixed_root/cmdline-tools/20.0/bin"
touch "$mixed_root/cmdline-tools/10.0/bin/sdkmanager"
chmod -x "$mixed_root/cmdline-tools/10.0/bin/sdkmanager"
touch "$mixed_root/cmdline-tools/20.0/bin/sdkmanager"
chmod +x "$mixed_root/cmdline-tools/20.0/bin/sdkmanager"
ANDROID_HOME="$mixed_root" bash "$script" link-cmdline-tools-latest
[ "$(readlink "$mixed_root/cmdline-tools/latest")" = "$mixed_root/cmdline-tools/20.0" ]
[ -x "$mixed_root/cmdline-tools/latest/bin/sdkmanager" ]

# A stale real `latest` directory without an executable sdkmanager must be
# replaced by the link instead of swallowing it.
stale_root="$fixture_root/stale-sdk"
mkdir -p "$stale_root/cmdline-tools/latest/bin" "$stale_root/cmdline-tools/20.0/bin"
touch "$stale_root/cmdline-tools/latest/bin/sdkmanager"
touch "$stale_root/cmdline-tools/20.0/bin/sdkmanager"
chmod +x "$stale_root/cmdline-tools/20.0/bin/sdkmanager"
ANDROID_HOME="$stale_root" bash "$script" link-cmdline-tools-latest
[ -L "$stale_root/cmdline-tools/latest" ]
[ -x "$stale_root/cmdline-tools/latest/bin/sdkmanager" ]

# A valid real `latest` directory must be preserved untouched.
valid_root="$fixture_root/valid-sdk"
mkdir -p "$valid_root/cmdline-tools/latest/bin"
touch "$valid_root/cmdline-tools/latest/bin/sdkmanager"
chmod +x "$valid_root/cmdline-tools/latest/bin/sdkmanager"
ANDROID_HOME="$valid_root" bash "$script" link-cmdline-tools-latest
[ ! -L "$valid_root/cmdline-tools/latest" ]
[ -x "$valid_root/cmdline-tools/latest/bin/sdkmanager" ]

echo 'Android storefront release script checks passed'

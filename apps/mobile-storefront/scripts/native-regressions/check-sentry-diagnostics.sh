#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../../../.." && pwd)"
probe_dir="$(mktemp -d "${TMPDIR:-/tmp}/baci-sentry-probe.XXXXXX")"
serial="${BACI_IOS_SIMULATOR_ID:-}"
booted_by_probe=0
cleanup() {
  if [[ "$booted_by_probe" == 1 ]]; then
    xcrun simctl shutdown "$serial" >/dev/null 2>&1 || true
  fi
  rm -rf "$probe_dir"
}
trap cleanup EXIT
if [[ -z "$serial" ]]; then
  xcrun simctl list devices available --json > "$probe_dir/devices.json"
  read -r serial state < <(python3 - "$probe_dir/devices.json" <<'PY'
import json, sys
devices = [d for runtime, ds in json.load(open(sys.argv[1]))['devices'].items()
           if '.iOS-' in runtime for d in ds if d.get('isAvailable')]
devices.sort(key=lambda d: (d['state'] != 'Booted', not d['name'].startswith('iPhone')))
if not devices:
    sys.exit('No available iOS simulator runtime for native Sentry regression.')
print(devices[0]['udid'], devices[0]['state'])
PY
  )
  if [[ "$state" != Booted ]]; then
    xcrun simctl boot "$serial"
    booted_by_probe=1
    xcrun simctl bootstatus "$serial" -b
  fi
fi
# Reuse the installed SDK's pinned, checksum-verified framework downloader.
cat > "$probe_dir/framework.rb" <<'RB'
root = ARGV.fetch(0)
sdk = File.join(root, 'node_modules/@sentry/react-native')
require File.join(sdk, 'scripts/sentry_utils.rb')
version = File.read(File.join(sdk, 'RNSentry.podspec'))[/sentry_cocoa_version = '([^']+)'/, 1]
abort 'Missing pinned Cocoa SDK version' unless version
puts File.join(ensure_sentry_xcframework(version), 'ios-arm64_x86_64-simulator')
RB
framework="$(ruby "$probe_dir/framework.rb" "$repo_root")"
policy_source="${1:-$repo_root/apps/mobile-storefront/config/sentry-native-diagnostics.swift}"
cat "$policy_source" \
  "$repo_root/apps/mobile-storefront/scripts/native-regressions/sentry-diagnostics.swift" > "$probe_dir/main.swift"
xcrun swiftc -target "$(uname -m)-apple-ios16.4-simulator" \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  -F "$framework" -framework Sentry -Xlinker -rpath -Xlinker "$framework" \
  "$probe_dir/main.swift" -o "$probe_dir/sentry-probe"
SIMCTL_CHILD_BACI_NATIVE_PROBE_CACHE="$probe_dir/cache" \
  xcrun simctl spawn "$serial" "$probe_dir/sentry-probe"

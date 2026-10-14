#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../../../.." && pwd)"
probe_dir="$(mktemp -d "${TMPDIR:-/tmp}/baci-gradient-probe.XXXXXX")"
trap 'rm -rf "$probe_dir"' EXIT
layer_source="${1:-$repo_root/node_modules/expo-linear-gradient/ios/LinearGradientLayer.swift}"
# ExpoModulesCore re-exports UIKit's UIColor (NSColor on macOS). Replace only
# that platform import so the installed production layer can run on this host.
sed 's/import ExpoModulesCore/import AppKit\ntypealias UIColor = NSColor/' "$layer_source" > "$probe_dir/LinearGradientLayer.swift"
cp "$repo_root/apps/mobile-storefront/scripts/native-regressions/gradient-layer.swift" "$probe_dir/main.swift"
xcrun swiftc "$probe_dir/LinearGradientLayer.swift" "$probe_dir/main.swift" -o "$probe_dir/gradient-probe"
"$probe_dir/gradient-probe"

# Compile the same source against UIKit and the app's minimum iOS target too.
sed 's/import ExpoModulesCore/import UIKit/' "$layer_source" > "$probe_dir/LinearGradientLayer-iOS.swift"
xcrun swiftc -typecheck -target arm64-apple-ios16.4-simulator -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" "$probe_dir/LinearGradientLayer-iOS.swift"

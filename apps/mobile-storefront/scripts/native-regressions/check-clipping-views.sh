#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../../../.." && pwd)"
probe_dir="$(mktemp -d "${TMPDIR:-/tmp}/baci-clipping-probe.XXXXXX")"
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
    sys.exit('No available iOS simulator runtime; install one before running the native regression.')
device = devices[0]
print(device['udid'], device['state'])
PY
  )
  if [[ "$state" != Booted ]]; then
    xcrun simctl boot "$serial"
    booted_by_probe=1
    xcrun simctl bootstatus "$serial" -b
  fi
fi
rn_root="${1:-$repo_root/node_modules/react-native}"
python3 - "$rn_root" "$repo_root" "$probe_dir/main.mm" <<'PY'
from pathlib import Path
import sys
rn, repo, output = map(Path, sys.argv[1:])
signature = '- (void)updateClippedSubviewsWithClipRect:(CGRect)clipRect relativeToView:(UIView *)clipView'
def method(relative):
    source = (rn / relative).read_text()
    start = source.index(signature)
    opening = source.index('{', start)
    depth = 1
    end = opening + 1
    while depth:
        if source[end] == '{': depth += 1
        if source[end] == '}': depth -= 1
        end += 1
    return source[start:end]
template = (repo / 'apps/mobile-storefront/scripts/native-regressions/clipping-views.mm').read_text()
template = template.replace('// INSERT_FORWARDING_METHOD', method('React/Fabric/Mounting/UIView+ComponentViewProtocol.mm'))
template = template.replace('// INSERT_CLIPPING_METHOD', method('React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm'))
template = template.replace('// INSERT_SCROLL_METHOD', method('React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm'))
Path(output).write_text(template)
PY
xcrun --sdk iphonesimulator clang++ -target "$(uname -m)-apple-ios16.4-simulator" \
  -isysroot "$(xcrun --sdk iphonesimulator --show-sdk-path)" -fobjc-arc \
  "$probe_dir/main.mm" -framework UIKit -framework QuartzCore -framework Foundation -framework CoreGraphics \
  -o "$probe_dir/clipping-probe"
xcrun simctl spawn "$serial" "$probe_dir/clipping-probe"

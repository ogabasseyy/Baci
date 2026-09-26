#!/usr/bin/env bash
# Fixture tests for check-mobile-gem-floors.sh.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checker="$script_dir/check-mobile-gem-floors.sh"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

write_lock() {
  local root="$1"
  local app="$2"
  local rubyzip_line="$3"
  mkdir -p "$root/$app"
  local version="${rubyzip_line#*rubyzip (}"
  version="${version%)}"
  {
    printf 'GEM\n'
    printf '  specs:\n'
    printf '%s\n' "$rubyzip_line"
    printf '\nCHECKSUMS\n'
    printf '  rubyzip (%s) sha256=fixture\n' "$version"
  } >"$root/$app/Gemfile.lock"
}

# Both apps above the floor: passes.
pass_root="$fixture_root/pass"
write_lock "$pass_root" apps/mobile-admin '    rubyzip (3.4.0)'
write_lock "$pass_root" apps/mobile-storefront '    rubyzip (3.7.0)'
bash "$checker" "$pass_root"

# One app below the floor: fails and names the app and version.
fail_root="$fixture_root/fail"
write_lock "$fail_root" apps/mobile-admin '    rubyzip (3.7.0)'
write_lock "$fail_root" apps/mobile-storefront '    rubyzip (2.4.1)'
if bash "$checker" "$fail_root" >"$fixture_root/fail.log" 2>&1; then
  echo "Expected rubyzip 2.4.1 to fail the floor check" >&2
  exit 1
fi
grep -q "apps/mobile-storefront" "$fixture_root/fail.log"
grep -q "2.4.1" "$fixture_root/fail.log"

# Boundary just under the floor: fails.
boundary_root="$fixture_root/boundary"
write_lock "$boundary_root" apps/mobile-admin '    rubyzip (3.3.9)'
write_lock "$boundary_root" apps/mobile-storefront '    rubyzip (3.7.0)'
if bash "$checker" "$boundary_root" >"$fixture_root/boundary.log" 2>&1; then
  echo "Expected rubyzip 3.3.9 to fail the floor check" >&2
  exit 1
fi
grep -q "3.3.9" "$fixture_root/boundary.log"

# Missing rubyzip entry: fails closed.
missing_root="$fixture_root/missing"
write_lock "$missing_root" apps/mobile-admin '    rubyzip (3.7.0)'
mkdir -p "$missing_root/apps/mobile-storefront"
printf 'GEM\n  specs:\n    rake (13.0.0)\n' >"$missing_root/apps/mobile-storefront/Gemfile.lock"
if bash "$checker" "$missing_root" >"$fixture_root/missing.log" 2>&1; then
  echo "Expected a missing rubyzip entry to fail the floor check" >&2
  exit 1
fi
grep -q "does not resolve rubyzip" "$fixture_root/missing.log"

echo "Mobile gem floor checks passed"

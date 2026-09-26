#!/usr/bin/env bash
# Regression guard for CVE-2026-85396 (rubyzip path traversal, first fixed
# in rubyzip 3.4.0). Fails when any mobile app's Gemfile.lock resolves
# rubyzip below the security floor, e.g. after a fastlane/lockfile update.

set -euo pipefail

repo_root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
apps="apps/mobile-admin apps/mobile-storefront"
floor_major=3
floor_minor=4
floor_patch=0

# Prints 0 (true) when $1 (a dotted version) is below the security floor.
version_below_floor() {
  local major='' minor='' patch=''
  IFS=. read -r major minor patch _ <<<"$1"
  major="${major%%[!0-9]*}"
  minor="${minor%%[!0-9]*}"
  patch="${patch%%[!0-9]*}"
  major="${major:-0}"
  minor="${minor:-0}"
  patch="${patch:-0}"
  if [ "$major" -lt "$floor_major" ]; then
    return 0
  fi
  if [ "$major" -gt "$floor_major" ]; then
    return 1
  fi
  if [ "$minor" -lt "$floor_minor" ]; then
    return 0
  fi
  if [ "$minor" -gt "$floor_minor" ]; then
    return 1
  fi
  [ "$patch" -lt "$floor_patch" ]
}

failed=0

for app in $apps; do
  lockfile="$repo_root/$app/Gemfile.lock"
  if [ ! -f "$lockfile" ]; then
    echo "::error::$app/Gemfile.lock not found" >&2
    failed=1
    continue
  fi
  # Match the specs section only (4-space indent); the CHECKSUMS section
  # repeats the entry with a 2-space indent.
  version="$(grep -m1 -o -E '^    rubyzip \([0-9][^)]*\)' "$lockfile" | sed -E 's/^    rubyzip \(([^)]*)\)$/\1/' || true)"
  if [ -z "$version" ]; then
    echo "::error::$app/Gemfile.lock does not resolve rubyzip" >&2
    failed=1
    continue
  fi
  if version_below_floor "$version"; then
    echo "::error::$app/Gemfile.lock resolves rubyzip $version, below the CVE-2026-85396 security floor $floor_major.$floor_minor.$floor_patch" >&2
    failed=1
    continue
  fi
  echo "$app: rubyzip $version meets the security floor"
done

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "All mobile apps meet the rubyzip security floor"

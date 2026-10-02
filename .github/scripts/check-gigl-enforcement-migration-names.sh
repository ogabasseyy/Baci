#!/usr/bin/env bash
# Fails when a migration that touches the GIGL least-privilege enforcement
# boundary does not carry "gigl" in its filename. The deploy tracking gate
# (.github/filters/deploy.yml) keys its smoke/latch checks on
# supabase/migrations/*gigl*; a hook/membership/wrapper change in a
# generically-named migration would apply via the broad migrations output
# without re-proving worker capability. Tree-wide (no merge-base), so it
# also catches violations merged with --no-verify. Scans the flat layout
# the tracking glob covers; directory layout itself is the version guard's
# business.
set -euo pipefail

migrations_dir="${1:-supabase/migrations}"
# Enforcement objects: the pre-request hook, the worker role (membership
# and SET ROLE target), and the wrapper RPC prefix. Table-only changes
# (monitors, notifications) are out of scope: they cannot move the hook
# boundary the smoke proves.
pattern='enforce_gigl_tracking_worker_request_scope|gigl_tracking_worker|gigl_worker_'
fail=0
while IFS= read -r file; do
  case "$(basename "$file")" in
    *gigl*) continue ;;
  esac
  if grep -E -q "$pattern" "$file"; then
    echo "GIGL enforcement migration must carry gigl in its filename: $file" >&2
    fail=1
  fi
done < <(find "$migrations_dir" -maxdepth 1 -name '*.sql' -type f | sort)
exit "$fail"

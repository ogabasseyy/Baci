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
# and SET ROLE target), the wrapper RPC prefix, the five underlying RPCs
# the wrappers delegate to via spoofed service_role (a semantics-widening
# body edit there must re-prove worker capability just like a wrapper
# edit), and the pgrst.db_pre_request setting that ACTIVATES the hook (a
# generically-named ALTER ROLE/DATABASE ... RESET without the hook name
# would otherwise commit unsmoked; the final-state check fails too late
# to roll it back). Table-only changes (monitors, notifications) are out
# of scope: they cannot move the boundary the smoke proves.
pattern='enforce_gigl_tracking_worker_request_scope|gigl_tracking_worker|gigl_worker_|claim_due_gigl_tracking_monitors|apply_gigl_tracking_result|record_gigl_tracking_failure|release_gigl_tracking_claim|pause_gigl_tracking_monitor|db_pre_request'
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

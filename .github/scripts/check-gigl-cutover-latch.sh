#!/usr/bin/env bash
# Reports the GIGL cutover latch as workflow outputs. Never fails: every
# error path reports latched=false / tracking_stale=true so callers fail
# closed. Usage:
#   check-gigl-cutover-latch.sh <remote-dir> <readiness-checkout-dir>
#
# The latch file proves a capability smoke verified token+hook function at
# the recorded revision — but a LATER tracking commit may have landed
# since. The tracking_stale output diffs the latched revision against
# HEAD over the deploy tracking filter, so a web push cannot bypass the
# smoke while unsmoked tracking changes are in the tree. The latch is
# also bound to the INSTALLED worker: deploy.sh preserves the latch file
# on promote, so without an installed-SHA check a manual promote of a
# different tree (rollback, or the exit-42 unverified path) would leave a
# latch that still validates while an unsmoked worker polls.
set -euo pipefail

remote_dir="${1:?remote dir is required}"
checkout_dir="${2:?readiness checkout dir is required}"
latch_file="$remote_dir/.gigl-capability-smoke-ok"

latched=false
latch_sha=""
if [ -f "$latch_file" ]; then
  candidate="$(tr -d '\r\n' < "$latch_file")"
  if [[ "$candidate" =~ ^[0-9a-f]{40}$ ]]; then
    latched=true
    latch_sha="$candidate"
  fi
fi

if [ "$latched" = true ]; then
  installed_sha=""
  if [ -f "$remote_dir/app-checkout.sha" ]; then
    installed_sha="$(tr -d '\r\n' < "$remote_dir/app-checkout.sha")"
  fi
  if [ "$installed_sha" != "$latch_sha" ]; then
    latched=false
    latch_sha=""
  fi
fi

tracking_stale=true
if [ "$latched" = true ]; then
  fetch_env=()
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    fetch_env=(git -c "http.extraHeader=AUTHORIZATION: bearer $GITHUB_TOKEN")
  else
    fetch_env=(git)
  fi
  if "${fetch_env[@]}" -C "$checkout_dir" fetch --quiet --depth 1 origin "$latch_sha" 2>/dev/null; then
    tracking_paths="$(awk '/^tracking:/ { in_group=1; next } /^[^ #]/ { in_group=0 } in_group && $1 == "-" { gsub(/'\''/, "", $2); print $2 }' "$checkout_dir/.github/filters/deploy.yml" 2>/dev/null || true)"
    if [ -n "$tracking_paths" ]; then
      # Word splitting is safe (filter paths cannot contain spaces), but
      # glob expansion is not: patterns like */gigl* would expand against
      # the runner cwd and silently drop newly added tracking files from
      # the diff. Disable globbing so git sees literal pathspecs.
      set -f
      # shellcheck disable=SC2086
      diff_output="$(git -C "$checkout_dir" diff --name-only "$latch_sha" HEAD -- $tracking_paths 2>/dev/null || echo "stale")"
      set +f
      if [ -z "$diff_output" ]; then
        tracking_stale=false
      fi
    fi
  fi
fi

# Default to stdout outside the workflow (local debugging, VPS shell),
# where GITHUB_OUTPUT is unset and `set -u` would abort before the
# fail-closed outputs are emitted.
output_file="${GITHUB_OUTPUT:-/dev/stdout}"
echo "latched=$latched" >> "$output_file"
echo "tracking_stale=$tracking_stale" >> "$output_file"

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
#
# Latch format is `<scope>:<sha>:<token-fingerprint>` where scope is the
# effective GIGL enablement the smoke observed. A disabled-scoped latch
# authorizes the bypass only while the worker is STILL disabled (vacuous
# cutover); any enablement flip in either direction invalidates, so a
# disabled smoke can never certify future enabled function and an enabled
# latch cannot survive a disable/re-enable cycle unproven. Enabled latches
# additionally bind the proven token fingerprint, so rotation, replacement,
# or removal of the token forces a re-smoke. Token EXPIRY is enforced at
# runtime instead: the VPS poller fails loud every 5 minutes on a bad
# token, so expiry can stall polling but never pass silently.
set -euo pipefail

remote_dir="${1:?remote dir is required}"
checkout_dir="${2:?readiness checkout dir is required}"
latch_file="$remote_dir/.gigl-capability-smoke-ok"

latched=false
latch_sha=""
latch_scope=""
latch_fingerprint=""
if [ -f "$latch_file" ]; then
  candidate="$(tr -d '\r\n' < "$latch_file")"
  latch_scope="${candidate%%:*}"
  rest="${candidate#*:}"
  latch_sha="${rest%%:*}"
  latch_fingerprint="${rest#*:}"
  case "$latch_scope" in
    enabled | disabled) ;;
    *) latch_scope="" ;;
  esac
  if [ -z "$latch_scope" ] || [[ ! "$latch_sha" =~ ^[0-9a-f]{40}$ ]] || [[ ! "$latch_fingerprint" =~ ^[0-9a-f]{64}$ ]]; then
    latch_scope=""
    latch_sha=""
    latch_fingerprint=""
  else
    latched=true
  fi
fi

invalidate_latch() {
  latched=false
  latch_sha=""
  latch_scope=""
  latch_fingerprint=""
}

if [ "$latched" = true ]; then
  installed_sha=""
  if [ -f "$remote_dir/app-checkout.sha" ]; then
    installed_sha="$(tr -d '\r\n' < "$remote_dir/app-checkout.sha")"
  fi
  if [ "$installed_sha" != "$latch_sha" ]; then
    invalidate_latch
  fi
fi

if [ "$latched" = true ]; then
  script_dir="$(unset CDPATH; cd -- "$(dirname -- "$0")" && pwd)"
  identity="$("$script_dir/resolve-gigl-latch-identity.sh" "$remote_dir" 2>/dev/null || true)"
  current_scope="${identity%% *}"
  current_fingerprint="${identity#* }"
  if [ "$current_scope" != "$latch_scope" ]; then
    invalidate_latch
  elif [ "$latch_scope" = "enabled" ] && [ "$current_fingerprint" != "$latch_fingerprint" ]; then
    invalidate_latch
  fi
fi

tracking_stale=true
if [ "$latched" = true ]; then
  # The job token must never appear in a process argument vector (visible
  # via `ps` on the shared runner): hand it to git through a 0600 config
  # file instead of `-c http.extraHeader=...`. Any failure here falls
  # back to unauthenticated git; the fetch then fails and the gate
  # fails closed via tracking_stale=true.
  fetch_env=(git)
  auth_config=""
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    auth_config="$(mktemp 2>/dev/null)" || auth_config=""
    if [ -n "$auth_config" ] && printf '[http]\n\textraHeader = AUTHORIZATION: bearer %s\n' "$GITHUB_TOKEN" > "$auth_config"; then
      fetch_env=(git -c "include.path=$auth_config")
    else
      [ -n "$auth_config" ] && rm -f "$auth_config"
      auth_config=""
    fi
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
  if [ -n "$auth_config" ]; then rm -f "$auth_config"; fi
fi

# Outside the workflow (local debugging, VPS shell) GITHUB_OUTPUT is
# unset: write plain stdout lines. Do NOT reopen /dev/stdout for
# append — on Linux that fails with ENXIO when stdout is a pipe,
# breaking the never-fail contract (proven by CI, which macOS masked).
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "latched=$latched" >> "$GITHUB_OUTPUT"
  echo "tracking_stale=$tracking_stale" >> "$GITHUB_OUTPUT"
else
  echo "latched=$latched"
  echo "tracking_stale=$tracking_stale"
fi

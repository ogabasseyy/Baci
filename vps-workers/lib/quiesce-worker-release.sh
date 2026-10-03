# shellcheck shell=bash
# Shared worker-release quiescing for promote AND emergency rollback.
# Both replace the shared bin/jobs/lib trees, so both must stop the
# persistent services and hold every scheduled worker lock across the
# swap — otherwise a non-GIGL tick runs a mixed release mid-sync.
#
# Usage (call ONCE per shell, BEFORE the first rsync):
#   . "<tree>/lib/quiesce-worker-release.sh"
#   quiesce_worker_release "$REMOTE_DIR" || exit 1
# Promote sources this from the STAGING tree (the revision being
# installed, so newly added services are covered); emergency rollback
# sources it from the LIVE tree (the revision actually running, so
# services slated for removal are still stopped). The function owns the
# caller's EXIT trap (service restart) and file descriptors from 10 up.
quiesce_worker_release() {
  local remote_dir="$1"

  # Re-entry would reopen already-held locks on fresh descriptors and
  # self-deadlock (flock locks are per open-file-description), so the
  # second call in one shell is a no-op.
  if [ "${gigl_quiesced:-0}" = 1 ]; then
    return 0
  fi
  gigl_quiesced=1

  # Stop the persistent systemd user services before quiescing: their
  # `--loop` workers hold runtime locks for life, so waiting on those
  # locks would stall every promote until the 600s timeout and then fail
  # the deploy. Only services that are actually active are stopped (fresh
  # hosts skip cleanly), and the EXIT trap restarts exactly those after
  # the flip — including on abort paths, so a failed promote never leaves
  # workers down. A cron `--once` fallback may tick while a service is
  # down, but the quiesce below holds the same lock, so it skips instead.
  gigl_stopped_services=""
  trap gigl_restart_services EXIT
  local gigl_service
  for gigl_service in baci-domain-event-router baci-event-delivery-worker baci-quiz-finalization; do
    if systemctl --user is-active -q "$gigl_service" 2>/dev/null; then
      systemctl --user stop "$gigl_service" || return 1
      gigl_stopped_services="$gigl_stopped_services $gigl_service"
    fi
  done

  # Quiesce every scheduled worker across the sync and flip: the checkout
  # symlink is shared, so a non-GIGL tick that lands mid-promote could
  # read half-synced wrappers or straddle two revisions. Lock names come
  # from the installed crontab (promote runs before the crontab install,
  # so these are exactly the entries that can tick now) plus any lock
  # file already present. Acquisition order is crontab first-appearance
  # (then alphabetical leftovers), NOT alphabetical: nested acquirers
  # (cron lines, AI trigger server) all take ollama-workload before
  # ai-storefront-jobs/agentic-commerce-health, and sharing that global
  # order is what keeps promote out of a deadlock cycle with them. One
  # exception is applied below: the remediation global lock is deferred
  # past every per-job lock, because first-appearance would otherwise
  # order it before its outers (see below).
  # Single-lock cron takes are non-blocking, so ticks skip instead of
  # queueing. Each fd stays open (hence held) until the calling shell
  # exits, which is after the flip/rollback below.
  local gigl_quiesce_names
  gigl_quiesce_names="$(
    {
      crontab -l 2>/dev/null | grep -o -E 'locks/[A-Za-z0-9_.-]+\.lock' | sed 's|^locks/||' || true
      for gigl_quiesce_path in "$remote_dir"/locks/*.lock; do
        [ -e "$gigl_quiesce_path" ] || continue
        basename "$gigl_quiesce_path"
      done
    } | awk '!seen[$0]++' | awk '
      # The remediation cron lines nest flock per-job (outer) -> global
      # (inner), but first-appearance lists the global lock -- first seen
      # on the vercel line -- before the later per-job locks. The canary
      # waits up to 600s on its inner global take, so holding the global
      # first would deadlock promotion against a canary tick (each holding
      # one lock, waiting on the other) for the full timeout. Defer the
      # global lock until every lock that can outer it is already held.
      # Nothing else nests global-outer except the deploy-lock-serialized
      # transition, so trailing it cannot open a new cycle.
      $0 == "error-remediator-global.lock" { hold_global = 1; next }
      { print }
      END { if (hold_global) print "error-remediator-global.lock" }
    '
  )"
  local gigl_quiesce_fd=10
  local gigl_quiesce_name
  while IFS= read -r gigl_quiesce_name; do
    [ -n "$gigl_quiesce_name" ] || continue
    # The outer promote command already holds the GIGL runtime lock, and
    # flock locks are per open-file-description: reopening it here would
    # conflict with the inherited hold and self-deadlock instead of
    # recursing. It stays held for the whole remote script, so skip it.
    [ "$gigl_quiesce_name" = "gigl-tracking.lock" ] && continue
    # Append mode: open (creating) without truncating, then hold
    # exclusive. Numeric fds via eval (not exec {fd}) stay compatible
    # with bash 3.2; the interpolated fd is arithmetic and the name
    # charset above excludes `/` and quotes, so no traversal. Each wait
    # is bounded (600s covers the longest cron timeout plus margin), so a
    # wedged tick fails the deploy loudly instead of hanging it forever.
    # shellcheck disable=SC2094
    eval "exec ${gigl_quiesce_fd}>>\"\$remote_dir/locks/${gigl_quiesce_name}\"" || return 1
    flock -w 600 -x "$gigl_quiesce_fd" || return 1
    gigl_quiesce_fd=$((gigl_quiesce_fd + 1))
  done <<EOF
$gigl_quiesce_names
EOF
}

gigl_restart_services() {
  local gigl_service
  for gigl_service in $gigl_stopped_services; do
    systemctl --user start "$gigl_service" || true
  done
  return 0
}

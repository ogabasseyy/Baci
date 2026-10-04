# shellcheck shell=bash
# Shared worker-release quiescing for promote AND emergency rollback.
# Both replace the shared bin/jobs/lib trees, so both must stop the
# persistent services and hold every scheduled worker lock across the
# swap — otherwise a non-GIGL tick runs a mixed release mid-sync.
#
# Usage (call ONCE per shell, BEFORE the first rsync):
#   . "<tree>/lib/quiesce-worker-release.sh"
#   quiesce_worker_release "$REMOTE_DIR" ["$STAGING_DIR/bin/gigl-dotenv.sh"] || exit 1
# Promote sources this from the STAGING tree (the revision being
# installed, so newly added services are covered); emergency rollback
# sources it from the LIVE tree (the revision actually running, so
# services slated for removal are still stopped). The function owns the
# caller's EXIT trap (service restart) and file descriptors from 10 up.
quiesce_worker_release() {
  local remote_dir="$1"
  # Optional staged dotenv reader (promote and rollback pass their
  # staging copy): preferred over the live one because it matches the
  # revision the transition installer parses with, and because the
  # live copy does not exist yet on first rollout (quiesce runs
  # before the rsync). Manual rollback callers without staging omit
  # it and keep the live-reader behavior.
  local gigl_dotenv_reader_override="${2:-}"

  # Re-entry would reopen already-held locks on fresh descriptors and
  # self-deadlock (flock locks are per open-file-description), so the
  # second call in one shell is a no-op.
  if [ "${gigl_quiesced:-0}" = 1 ]; then
    return 0
  fi
  gigl_quiesced=1

  # The remediation global lock PATH is configurable
  # (BACI_REMEDIATION_GLOBAL_LOCK_PATH in the live .env; the transition
  # installer honors absolute paths and relatives outside locks/, and
  # the remediator flocks the resolved path). A hardcoded default here
  # would order a renamed global lock by first-appearance and deadlock
  # promotion against a canary tick the same way an unordered default
  # would — and holding locks/<basename> instead of the real path
  # would let a directly launched remediator execute mid-promote — so
  # resolve it exactly the way the transition installer does: the LIVE
  # .env (the running entries hold the current path, not the staged
  # revision's) through the shared reader. The staged override wins
  # when provided (it matches the transition installer's revision and
  # exists on first rollout, when the live copy is not installed
  # yet); otherwise the live bin/ copy; otherwise the default — which
  # is also what the transition would use on a readerless tree.
  local gigl_global_lock="error-remediator-global.lock"
  local gigl_global_path="$remote_dir/locks/error-remediator-global.lock"
  local gigl_dotenv_reader="$remote_dir/bin/gigl-dotenv.sh"
  if [ -n "$gigl_dotenv_reader_override" ] && [ -f "$gigl_dotenv_reader_override" ]; then
    gigl_dotenv_reader="$gigl_dotenv_reader_override"
  fi
  if [ -f "$gigl_dotenv_reader" ]; then
    # shellcheck disable=SC1090
    . "$gigl_dotenv_reader"
    local gigl_global_value
    gigl_global_value="$(gigl_dotenv_value "$remote_dir/.env" 'BACI_REMEDIATION_GLOBAL_LOCK_PATH' 2>/dev/null || true)"
    if [ -n "$gigl_global_value" ]; then
      if [[ "$gigl_global_value" = /* ]]; then
        gigl_global_path="$gigl_global_value"
      else
        gigl_global_path="$remote_dir/$gigl_global_value"
      fi
      gigl_global_lock="$(basename "$gigl_global_value")"
    fi
  fi
  # A same-inode spelling of the locks/ path (locks/../locks/x.lock, a
  # symlink) is the standard case, not a second lock: holding both
  # spellings would self-deadlock (same inode on two fds, and flock
  # locks are per open-file-description).
  if [ -e "$gigl_global_path" ] && [ "$gigl_global_path" -ef "$remote_dir/locks/$gigl_global_lock" ]; then
    gigl_global_path="$remote_dir/locks/$gigl_global_lock"
  fi
  # Basename deferral only covers locks/*.lock (the crontab grep and
  # file scan below cannot see any other path). A global lock outside
  # locks/ — or a suffixless basename inside it, which the .lock-only
  # scanners likewise never emit — defers nothing by name; it is held
  # exactly, after the loop. Deferring an undiscoverable name would
  # skip BOTH holds (the loop never sees it, the exact fallback is
  # gated on an empty deferral), leaving the promote unquiesced.
  local gigl_defer_name=""
  if [ "$gigl_global_path" = "$remote_dir/locks/$gigl_global_lock" ]; then
    case "$gigl_global_lock" in
      *.lock) gigl_defer_name="$gigl_global_lock" ;;
    esac
  fi

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
    } | awk '!seen[$0]++' | awk -v gigl_global="$gigl_defer_name" '
      # The remediation cron lines nest flock per-job (outer) -> global
      # (inner), but first-appearance lists the global lock -- first seen
      # on the vercel line -- before the later per-job locks. The canary
      # waits up to 600s on its inner global take, so holding the global
      # first would deadlock promotion against a canary tick (each holding
      # one lock, waiting on the other) for the full timeout. Defer the
      # global lock until every lock that can outer it is already held.
      # Nothing else nests global-outer except the deploy-lock-serialized
      # transition, so trailing it cannot open a new cycle. The deferred
      # name is the configured locks/ global lock resolved above, not
      # the default: a renamed global lock nests the same way. (Empty
      # for an outside-locks/ path, which is held exactly below.)
      $0 == gigl_global { hold_global = 1; next }
      { print }
      END { if (hold_global) print gigl_global }
    '
  )"
  local gigl_quiesce_fd=10
  local gigl_quiesce_name
  local gigl_quiesce_locks=()
  # Collect names before opening persistent descriptors. A redirected while
  # loop makes Bash reserve fd 10 to restore stdin and mark it close-on-exec;
  # opening our first lock on that fd inside the loop leaves flock unable to
  # inherit it. The for loop below has no stdin redirection to collide with.
  while IFS= read -r gigl_quiesce_name; do
    [ -n "$gigl_quiesce_name" ] || continue
    gigl_quiesce_locks+=("$gigl_quiesce_name")
  done <<EOF
$gigl_quiesce_names
EOF
  for gigl_quiesce_name in "${gigl_quiesce_locks[@]:-}"; do
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
  done
  # A global lock outside locks/ (absolute, or relative elsewhere) is
  # invisible to the name loop above, so hold the exact configured path
  # on its own fd AFTER every per-job lock: deferred-last by
  # construction, under the same deadlock argument as the name
  # deferral. The transition installer created the parent and file; a
  # missing parent fails the deploy loudly (the remediator itself
  # could not flock it either), while a missing file is recreated by
  # the append-open and held like any other.
  if [ -z "$gigl_defer_name" ]; then
    # Unlike the loop names (charset-restricted), the exact path is
    # operator-configured and may contain spaces: %q-escape it for the
    # eval (bash 3.2 compatible, like the numeric-fd form above).
    local gigl_global_path_q
    printf -v gigl_global_path_q '%q' "$gigl_global_path"
    # shellcheck disable=SC2094
    eval "exec ${gigl_quiesce_fd}>>$gigl_global_path_q" || return 1
    flock -w 600 -x "$gigl_quiesce_fd" || return 1
    gigl_quiesce_fd=$((gigl_quiesce_fd + 1))
  fi
}

gigl_restart_services() {
  local gigl_service
  for gigl_service in $gigl_stopped_services; do
    systemctl --user start "$gigl_service" || true
  done
  return 0
}

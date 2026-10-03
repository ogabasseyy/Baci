#!/usr/bin/env bash

cleanup_worker_staging() {
  ssh "$VPS" "rm -rf '$STAGING_DIR'" >/dev/null 2>&1 || true
}

# Populates STAGING_DIR and NODE_BIN for deploy.sh. Source this helper before
# calling the function, and call it before installing services or crontab.
prepare_worker_release() {
  STAGING_DIR="${REMOTE_DIR}.deploy-${APP_SHA}-$$"
  trap cleanup_worker_staging EXIT

  echo "==> Staging worker files at $VPS:$STAGING_DIR"
  rsync -av --delete --exclude='.env*' --exclude='node_modules' --exclude='logs' --exclude='locks' \
    "$WORKER_ROOT/" "$VPS:$STAGING_DIR/"
  # The GIGL scoped-env filter reads the shared dotenv through the same
  # tested parser as the CI gates; ship it next to the filter (single
  # source: .github/scripts/gigl-dotenv.sh) so the two can never
  # disagree on export/quote/comment forms.
  rsync -av "$WORKER_ROOT/../.github/scripts/gigl-dotenv.sh" "$VPS:$STAGING_DIR/bin/gigl-dotenv.sh"
  if ! ssh "$VPS" "test -f '$REMOTE_DIR/.env'"; then
    echo "Missing $VPS:$REMOTE_DIR/.env; create it before running this deploy." >&2
    exit 1
  fi
  ssh "$VPS" "cp '$REMOTE_DIR/.env' '$STAGING_DIR/.env'"
  ssh "$VPS" "printf '%s' '$APP_SHA' > '$STAGING_DIR/app-checkout.sha'"

  echo "==> Installing staged dependencies on VPS"
  ssh "$VPS" "cd '$STAGING_DIR' && CI=true pnpm install --frozen-lockfile --prod"

  echo "==> Resolving Node.js path on VPS"
  NODE_BIN=$(ssh "$VPS" "command -v node || echo /usr/bin/node")
  echo "    Using Node: $NODE_BIN"

  echo "==> Validating direct worker environment"
  if ! ssh "$VPS" "cd '$STAGING_DIR' && $NODE_BIN '$STAGING_DIR/jobs/preflight-direct-web-workers.mjs'"; then
    echo "Direct-worker environment preflight failed; live worker files and crontab were not changed." >&2
    exit 1
  fi

  echo "==> Provisioning immutable application checkout for $APP_SHA"
  # The provisioner ships inside the staged tree, so this revision's own
  # checkout logic runs (not whatever a previous promote installed).
  ssh "$VPS" "bash '$STAGING_DIR/lib/provision-immutable-checkout.sh' '$STAGING_DIR' '$APP_SHA'"

  echo "==> Verifying the live GIGL database capability"
  gigl_capability_status=0
  ssh "$VPS" "NODE_ENV=production BACI_WORKER_PROFILE=gigl-tracking BACI_WORKER_ENV='$STAGING_DIR/.env' '$STAGING_DIR/bin/verify-gigl-tracking-worker-capability.sh'" || gigl_capability_status=$?
  if [ "$gigl_capability_status" -eq 42 ]; then
    # Exit 42 means the wrapper RPCs or the worker grant are missing. That
    # is expected ONLY before the isolation migrations land (initial
    # rollout): the RPCs land via db-migrations minutes later, so install
    # the worker now (readiness requires it) and let the post-migration
    # workflow smoke verify capability before the web deploy. But the same
    # exit after a smoke has PROVED token+hook function (a non-vacuous
    # latch exists) USUALLY means the grant/membership/schema regressed:
    # refuse to promote over the previously-proven worker instead of
    # deferring -- UNLESS the candidate tree adds GIGL migrations since
    # the latched revision, which independently explains the 42 as
    # schema-behind-code (a coordinated wrapper migration): then defer so
    # the workflow can apply the migration and verify afterwards.
    # Without that transition, refusing would deadlock wrapper
    # migrations (readiness needs the new worker before db-migrations,
    # but the worker could never promote against the old schema).
    # Latch format is scope:sha:fingerprint; a vacuous latch (disabled
    # scope, empty-sha256 fingerprint) proves no token ever functioned, so
    # it stays deferrable (initial token rollout, disabled-path restore).
    gigl_latch="$(ssh "$VPS" "cat '$REMOTE_DIR/.gigl-capability-smoke-ok' 2>/dev/null" || true)"
    gigl_latch_scope="${gigl_latch%%:*}"
    gigl_latch_fp="${gigl_latch##*:}"
    gigl_latch_rest="${gigl_latch#*:}"
    gigl_latch_sha="${gigl_latch_rest%%:*}"
    gigl_defer_ok=""
    gigl_defer_reason="wrapper RPCs are not deployed yet"
    if [ -z "$gigl_latch" ]; then
      gigl_defer_ok=1
    fi
    if [ "$gigl_latch_scope" = "disabled" ] && [ "$gigl_latch_fp" = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ]; then
      gigl_defer_ok=1
    fi
    if [ -z "$gigl_defer_ok" ] && [[ "$gigl_latch_sha" =~ ^[0-9a-f]{40}$ ]]; then
      # Completeness: the enforcement-migration naming check forces any
      # migration that could cause a 42 into a gigl-named file, so
      # diffing supabase/migrations/*gigl* cannot miss an explanation.
      # An unresolvable latch SHA defers (old behavior): refusal must
      # only fire when no migration PROVABLY explains the 42. (A
      # malformed latch skips this branch and refuses below.)
      gigl_migration_diff="$(git -C "$WORKER_ROOT/.." diff --name-only "$gigl_latch_sha" "$APP_SHA" -- 'supabase/migrations/*gigl*' 2>/dev/null)" || gigl_migration_diff="unknown"
      if [ "$gigl_migration_diff" = "unknown" ] || [ -n "$gigl_migration_diff" ]; then
        gigl_defer_ok=1
        gigl_defer_reason="candidate adds GIGL migrations since the latched revision"
      fi
    fi
    if [ -n "$gigl_defer_ok" ]; then
      echo "GIGL $gigl_defer_reason; deferring capability verification to the post-migration smoke." >&2
    else
      echo "GIGL capability check reports missing RPCs/grant, but a previous smoke proved this worker (latch scope: $gigl_latch_scope) and no new GIGL migrations since the latched revision explain it; refusing to promote a worker that cannot claim tracking work. Investigate the revoked grant/membership or regressed schema. If the database was restored from a pre-migration backup, remove $REMOTE_DIR/.gigl-capability-smoke-ok on the VPS and rerun this deploy." >&2
      exit 1
    fi
  elif [ "$gigl_capability_status" -ne 0 ]; then
    echo "GIGL database capability verification failed; live worker files and crontab were not changed." >&2
    exit 1
  fi
}

promote_worker_release() {
  echo "==> Promoting validated worker files to $VPS:$REMOTE_DIR"
  # Promote also holds the GIGL runtime lock exclusive across the file
  # sync and the checkout flip: the cron takes it non-blocking, so a tick
  # that would land between new wrappers and the old checkout (or vice
  # versa) skips instead of running mixed-revision. A running poll delays
  # promote by at most one tick (its own timeout + kill-after); lock order
  # is deploy-then-gigl while cron takes gigl only, so no cycle. The
  # remote script additionally quiesces EVERY scheduled worker lock
  # (parsed from the installed crontab) across the same window, because
  # the flipped checkout symlink is shared: without that, a Petrock,
  # quiz, or other tick could read half-synced wrappers or straddle two
  # revisions. The three persistent `--loop` systemd services are
  # stopped first (they hold locks for life) and restarted by an EXIT
  # trap that also covers abort paths. The locks dir is pre-created
  # because flock will not create parents.
  ssh "$VPS" "mkdir -p '$REMOTE_DIR/locks' && flock -x /tmp/baci-workers-deploy.lock flock -x '$REMOTE_DIR/locks/gigl-tracking.lock' bash -s -- '$STAGING_DIR' '$REMOTE_DIR' '$APP_SHA'" <<'REMOTE_SH'
set -euo pipefail

staging_dir="$1"
remote_dir="$2"
expected_sha="$3"

mkdir -p "$remote_dir"
# The capability-smoke latch survives promotes: it records that a live
# smoke proved token+hook function, which a worker redeploy (same .env,
# same token) does not invalidate. Without this exclude, --delete would
# wipe it every deploy.sh run and re-freeze web pushes until re-smoked.
# Safety net: check-gigl-cutover-latch.sh binds the latch to
# app-checkout.sha at read time, so promoting a DIFFERENT tree (rollback
# or the exit-42 unverified path) invalidates the preserved latch until
# a fresh smoke re-latches the installed revision.
mkdir -p "$remote_dir/logs" "$remote_dir/locks"

# Stop the persistent systemd user services before quiescing: their
# `--loop` workers hold runtime locks for life, so waiting on those
# locks would stall every promote until the 600s timeout and then fail
# the deploy. Only services that are actually active are stopped (fresh
# hosts skip cleanly), and the EXIT trap restarts exactly those after
# the flip — including on abort paths, so a failed promote never leaves
# workers down. A cron `--once` fallback may tick while a service is
# down, but the quiesce below holds the same lock, so it skips instead.
gigl_stopped_services=""
gigl_restart_services() {
  for gigl_service in $gigl_stopped_services; do
    systemctl --user start "$gigl_service" || true
  done
  return 0
}
trap gigl_restart_services EXIT
for gigl_service in baci-domain-event-router baci-event-delivery-worker baci-quiz-finalization; do
  if systemctl --user is-active -q "$gigl_service" 2>/dev/null; then
    systemctl --user stop "$gigl_service" || exit 1
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
# queueing. Each fd stays open (hence held) until this remote shell
# exits, which is after the flip below.
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
gigl_quiesce_fd=10
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
  eval "exec ${gigl_quiesce_fd}>>\"\$remote_dir/locks/${gigl_quiesce_name}\"" || exit 1
  flock -w 600 -x "$gigl_quiesce_fd" || exit 1
  gigl_quiesce_fd=$((gigl_quiesce_fd + 1))
done <<EOF
$gigl_quiesce_names
EOF

rsync -a --delete --exclude='.env*' --exclude='logs' --exclude='locks' --exclude='.gigl-capability-smoke-ok' \
  "$staging_dir/" "$remote_dir/"

# Atomically switch the delegated checkout to this release's immutable
# per-SHA worktree inside this same deploy lock, so wrappers, SHA
# marker, and executed code change together: cron resolves BACI_REPO_DIR
# once per invocation, so no poll can run unverified code or straddle
# two revisions mid-run.
bash "$staging_dir/lib/flip-immutable-checkout.sh" "$remote_dir" "$expected_sha"
REMOTE_SH
}

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

# Quiesce every scheduled worker plus the persistent services across
# the sync and flip (shared helper, also used by emergency rollback):
# the checkout symlink is shared, so a non-GIGL tick that lands
# mid-promote could read half-synced wrappers or straddle two
# revisions. Sourced from STAGING (the revision being installed), so a
# newly added service is covered; the sourced functions live in this
# shell's memory, so the rsync below cannot disturb them.
# shellcheck source=quiesce-worker-release.sh
. "$staging_dir/lib/quiesce-worker-release.sh"
quiesce_worker_release "$remote_dir" || exit 1

# Snapshot the pre-promote live tree BEFORE the rsync below mutates
# it: if the checkout flip then refuses (the per-SHA checkout went
# missing or invalid between prepare and promote), the rsync has
# already replaced bin/, jobs/, lib/, config/, dependencies, and the
# SHA marker while app-live still points at the previous checkout.
# Restoring the snapshot keeps the quiesce EXIT trap from restarting
# services against that mixed release. Entries that do not exist yet
# (first deploy) are skipped on both legs; a snapshot failure refuses
# the promote before anything is mutated. The backup sits BESIDE the
# live dir (never inside the synced tree). It SURVIVES a successful
# promote: the post-flip overlap record may still fail, and
# rollback_worker_release below restores this snapshot then. deploy.sh
# removes it after a successful record; a crashed run's residue is
# cleared by the next promote before snapshotting (the deploy lock
# above serializes promotes, so no live backup is ever clobbered).
pre_promote_backup="${remote_dir}.pre-promote-backup"
rm -rf "$pre_promote_backup"
mkdir -p "$pre_promote_backup"
for entry in bin jobs lib config node_modules app-checkout.sha; do
  if [ -e "$remote_dir/$entry" ]; then
    cp -a "$remote_dir/$entry" "$pre_promote_backup/$entry" || exit 1
  fi
done

rsync -a --delete --exclude='.env*' --exclude='logs' --exclude='locks' --exclude='.gigl-capability-smoke-ok' \
  "$staging_dir/" "$remote_dir/"

# Snapshot the checkout pointer for rollback: the flip's one-time
# legacy migration lossily rewrites .env (deletes every `=`-spelling)
# and creates the app-live sibling symlink. The target file records
# the pre-flip link (or NOSYMLINK) so first-deploy rollback removes
# or re-points exactly that — no invented defaults: like the flip,
# an unset BACI_REPO_DIR resolves empty (and the flip then fails
# before mutating, so this snapshot goes unconsumed).
if [ -e "$remote_dir/.env" ]; then
  cp -a "$remote_dir/.env" "$pre_promote_backup/.env"
  # shellcheck source=../bin/gigl-dotenv.sh
  . "$staging_dir/bin/gigl-dotenv.sh"
  snapshot_link="$(gigl_dotenv_value "$remote_dir/.env" 'BACI_REPO_DIR')"
  if [ -L "$snapshot_link" ]; then readlink "$snapshot_link"; else echo "NOSYMLINK"; fi > "$pre_promote_backup/app-live-target"
fi

# Atomically switch the delegated checkout to this release's immutable
# per-SHA worktree inside this same deploy lock, so wrappers, SHA
# marker, and executed code change together: cron resolves BACI_REPO_DIR
# once per invocation, so no poll can run unverified code or straddle
# two revisions mid-run.
if ! bash "$staging_dir/lib/flip-immutable-checkout.sh" "$remote_dir" "$expected_sha"; then
  echo "Checkout flip failed; restoring the pre-promote live tree." >&2
  for entry in bin jobs lib config node_modules; do
    if [ -e "$pre_promote_backup/$entry" ]; then
      rsync -a --delete "$pre_promote_backup/$entry/" "$remote_dir/$entry/"
    else
      rm -rf "$remote_dir/$entry"
    fi
  done
  if [ -e "$pre_promote_backup/app-checkout.sha" ]; then
    cp "$pre_promote_backup/app-checkout.sha" "$remote_dir/app-checkout.sha"
  else
    rm -f "$remote_dir/app-checkout.sha"
  fi
  rm -rf "$pre_promote_backup"
  exit 1
fi
# No snapshot cleanup on success: rollback_worker_release needs it if
# the post-flip overlap record fails (deploy.sh removes it after a
# successful record).
REMOTE_SH
}

# Restores the pre-promote live tree after a failed post-flip overlap
# record. Call ONLY from deploy.sh's record-failure branch, which runs
# before the cron transition and the service/crontab installs: at that
# point the promote is the sole live mutation, so restoring the
# snapshot plus the checkout pointer returns the VPS to its exact
# pre-deploy state — and the standing pre-flip record (which lists
# every run in flight at flip time) is once again complete, so no
# workflow can publish off stale reads. A missing snapshot fails
# loudly: the operator follows the emergency rollback runbook.
rollback_worker_release() {
  echo "==> Rolling back the unrecorded worker promotion on $VPS:$REMOTE_DIR"
  ssh "$VPS" "mkdir -p '$REMOTE_DIR/locks' && flock -x /tmp/baci-workers-deploy.lock flock -x '$REMOTE_DIR/locks/gigl-tracking.lock' bash -s -- '$STAGING_DIR' '$REMOTE_DIR'" <<'REMOTE_SH'
set -euo pipefail

staging_dir="$1"
remote_dir="$2"
pre_promote_backup="${remote_dir}.pre-promote-backup"
if [ ! -d "$pre_promote_backup" ]; then
  echo "Rollback refused: no pre-promote snapshot at $pre_promote_backup; follow the emergency rollback runbook." >&2
  exit 1
fi

# Same quiesce as promote (locks plus persistent services): ticks must
# skip across the restore, and the EXIT trap restarts services after
# the old tree is back — never against a half-restored mix.
# shellcheck source=quiesce-worker-release.sh
. "$staging_dir/lib/quiesce-worker-release.sh"
quiesce_worker_release "$remote_dir" || exit 1

for entry in bin jobs lib config node_modules; do
  if [ -e "$pre_promote_backup/$entry" ]; then
    rsync -a --delete "$pre_promote_backup/$entry/" "$remote_dir/$entry/"
  else
    rm -rf "$remote_dir/$entry"
  fi
done
if [ -e "$pre_promote_backup/app-checkout.sha" ]; then
  cp "$pre_promote_backup/app-checkout.sha" "$remote_dir/app-checkout.sha"
  # Flip the checkout pointer back: the old per-SHA worktree survives
  # (promote GC keeps the previous release), so the standard flip —
  # with its symlink verification — converges back exactly. A poll
  # that launched against the new checkout keeps executing it (GC
  # keeps the just-replaced target too); only new ticks see old code.
  bash "$staging_dir/lib/flip-immutable-checkout.sh" "$remote_dir" "$(cat "$remote_dir/app-checkout.sha")"
else
  # First deploy (no previous tree): the flip may have run its
  # one-time legacy migration (created the app-live sibling symlink
  # and lossily re-pointed .env at it). Reverse exactly that from the
  # pointer snapshot — otherwise the restarted legacy wrappers would
  # execute candidate code through the leftover symlink. The link
  # path comes from the REWRITTEN .env (its canonical line is the
  # created symlink in the migration case, the untouched original in
  # the pre-existing-symlink case), read BEFORE the .env restore.
  # A pre-existing symlink (markerless manual state) is re-pointed to
  # its pre-flip target instead of removed.
  # shellcheck source=../bin/gigl-dotenv.sh
  . "$staging_dir/bin/gigl-dotenv.sh"
  rollback_link="$(gigl_dotenv_value "$remote_dir/.env" 'BACI_REPO_DIR')"
  if [ -e "$pre_promote_backup/.env" ]; then
    cp "$pre_promote_backup/.env" "$remote_dir/.env"
  fi
  if [ "$(cat "$pre_promote_backup/app-live-target" 2>/dev/null)" = "NOSYMLINK" ]; then
    if [ -L "$rollback_link" ]; then rm -f "$rollback_link"; fi
  elif [ -e "$pre_promote_backup/app-live-target" ]; then
    ln -sfn "$(cat "$pre_promote_backup/app-live-target")" "$rollback_link"
  fi
  rm -f "$remote_dir/app-checkout.sha"
fi
rm -rf "$pre_promote_backup"
REMOTE_SH
}

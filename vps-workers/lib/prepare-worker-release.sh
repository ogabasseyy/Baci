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
    # Exit 42 means the wrapper RPCs predate the migration (initial rollout):
    # the RPCs land via db-migrations minutes later, so install the worker
    # now (readiness requires it) and let the post-migration workflow smoke
    # verify capability before the web deploy.
    echo "GIGL wrapper RPCs are not deployed yet; deferring capability verification to the post-migration smoke." >&2
  elif [ "$gigl_capability_status" -ne 0 ]; then
    echo "GIGL database capability verification failed; live worker files and crontab were not changed." >&2
    exit 1
  fi
}

promote_worker_release() {
  echo "==> Promoting validated worker files to $VPS:$REMOTE_DIR"
  ssh "$VPS" "flock -x /tmp/baci-workers-deploy.lock bash -s -- '$STAGING_DIR' '$REMOTE_DIR' '$APP_SHA'" <<'REMOTE_SH'
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
rsync -a --delete --exclude='.env*' --exclude='logs' --exclude='locks' --exclude='.gigl-capability-smoke-ok' \
  "$staging_dir/" "$remote_dir/"
mkdir -p "$remote_dir/logs" "$remote_dir/locks"

# Atomically switch the delegated checkout to this release's immutable
# per-SHA worktree inside this same deploy lock, so wrappers, SHA
# marker, and executed code change together: cron resolves BACI_REPO_DIR
# once per invocation, so no poll can run unverified code or straddle
# two revisions mid-run.
bash "$staging_dir/lib/flip-immutable-checkout.sh" "$remote_dir" "$expected_sha"
REMOTE_SH
}

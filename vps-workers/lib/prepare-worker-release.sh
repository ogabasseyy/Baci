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
  if ! ssh "$VPS" "test -f '$REMOTE_DIR/.env'"; then
    echo "Missing $VPS:$REMOTE_DIR/.env; create it before running this deploy." >&2
    exit 1
  fi
  ssh "$VPS" "cp '$REMOTE_DIR/.env' '$STAGING_DIR/.env'"

  echo "==> Installing staged dependencies on VPS"
  ssh "$VPS" "cd '$STAGING_DIR' && CI=true pnpm install --frozen-lockfile --prod"

  echo "==> Resolving Node.js path on VPS"
  NODE_BIN=$(ssh "$VPS" "command -v node || echo /usr/bin/node")
  echo "    Using Node: $NODE_BIN"

  echo "==> Validating direct Petrock and quiz worker environment"
  if ! ssh "$VPS" "cd '$STAGING_DIR' && $NODE_BIN '$STAGING_DIR/jobs/preflight-direct-web-workers.mjs'"; then
    echo "Direct-worker environment preflight failed; live worker files and crontab were not changed." >&2
    exit 1
  fi

  echo "==> Verifying direct-worker application checkout"
  ssh "$VPS" "bash -s -- '$STAGING_DIR' '$APP_SHA'" <<'REMOTE_SH'
set -euo pipefail

remote_dir="$1"
expected_sha="$2"
env_file="$remote_dir/.env"
repo_dir="$(
  awk '
    /^BACI_REPO_DIR=/ {
      sub(/^BACI_REPO_DIR=/, "")
      print
      exit
    }
  ' "$env_file"
)"
repo_dir="${repo_dir%\"}"
repo_dir="${repo_dir#\"}"
repo_dir="${repo_dir%\'}"
repo_dir="${repo_dir#\'}"

case "$repo_dir" in
  /*) ;;
  *)
    echo "BACI_REPO_DIR must be an absolute path." >&2
    exit 1
    ;;
esac

actual_sha="$(git -C "$repo_dir" rev-parse --verify HEAD)"
if [ -n "$(git -C "$repo_dir" status --porcelain=v1 --untracked-files=all)" ]; then
  echo "Direct-worker checkout is dirty." >&2
  exit 1
fi
if [ "$actual_sha" != "$expected_sha" ]; then
  echo "Direct-worker checkout does not match the deploying commit." >&2
  exit 1
fi

for script_path in \
  apps/web/src/scripts/process-petrock-reconciliation.ts \
  apps/web/src/scripts/process-quiz-finalization.ts
do
  if [ ! -f "$repo_dir/$script_path" ]; then
    echo "Direct-worker checkout is missing $script_path." >&2
    exit 1
  fi
done

for wrapper_path in \
  "$remote_dir/bin/process-petrock-reconciliation.sh" \
  "$remote_dir/bin/process-quiz-finalization.sh"
do
  if [ ! -x "$wrapper_path" ]; then
    echo "Missing or non-executable direct-worker wrapper: $wrapper_path" >&2
    exit 1
  fi
done

tsx_bin="$repo_dir/apps/web/node_modules/.bin/tsx"
if [ ! -x "$tsx_bin" ]; then
  # Mirror run-web-script.sh: a workspace-root install also satisfies the
  # worker entrypoints, so validate the same fallback before failing.
  tsx_bin="$repo_dir/node_modules/.bin/tsx"
fi
if [ ! -x "$tsx_bin" ] || ! "$tsx_bin" --version >/dev/null; then
  echo "Direct-worker checkout is missing the reviewed web toolchain." >&2
  exit 1
fi
REMOTE_SH
}

promote_worker_release() {
  echo "==> Promoting validated worker files to $VPS:$REMOTE_DIR"
  ssh "$VPS" "flock -x /tmp/baci-workers-deploy.lock bash -s -- '$STAGING_DIR' '$REMOTE_DIR'" <<'REMOTE_SH'
set -euo pipefail

staging_dir="$1"
remote_dir="$2"

mkdir -p "$remote_dir"
rsync -a --delete --exclude='.env*' --exclude='logs' --exclude='locks' \
  "$staging_dir/" "$remote_dir/"
mkdir -p "$remote_dir/logs" "$remote_dir/locks"
REMOTE_SH
}

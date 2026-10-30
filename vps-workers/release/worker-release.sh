#!/usr/bin/env bash
# Builds and activates VPS worker releases as the dedicated `baci-worker`
# user. The deploy runner invokes it through sync-from-runner.sh with
# `sudo -n -u baci-worker`, so dependency lifecycle scripts and the worker
# runtime never share an OS identity with deployment credentials.
#
# Usage: worker-release.sh build <sha> | activate <sha> | rollback | status
#
# Provenance: the commit is fetched by this user from the public origin
# over HTTPS and must be reachable from origin/main, so a caller can only
# select a commit that is already on main.
set -euo pipefail

ROOT="${BACI_WORKER_ROOT:-/srv/baci-worker}"
ORIGIN="${BACI_WORKER_ORIGIN:-https://github.com/ogabasseyy/Baci.git}"
NODE_BIN="${BACI_WORKER_NODE_BIN:-/usr/bin/node}"
LOCK_WAIT="${BACI_WORKER_LOCK_WAIT_SECONDS:-180}"
REPO="$ROOT/repo.git"
RELEASES="$ROOT/releases"
WORKERS="$ROOT/baci-workers"
# Entries of the persistent worker directory that never come from a release.
PERSISTENT_ENTRIES=' .env logs locks state .gigl-capability-smoke-ok app-checkout.sha '
CRON_BLOCK_START='# >>> baci-workers >>>'
CRON_BLOCK_END='# <<< baci-workers <<<'
# Codex remediation needs Docker, which this unprivileged user must not have.
REMEDIATION_JOBS='vercel-error-remediator.mjs|sentry-mobile-error-remediator.mjs|posthog-error-remediator.mjs|remediation-codex-canary.mjs|cleanup-remediation-storage.mjs'

fail() {
  echo "worker-release: $*" >&2
  exit 1
}

require_sha() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] || fail "expected a lowercase 40-character commit SHA."
}

current_sha() {
  local target
  target="$(readlink "$ROOT/current" 2>/dev/null)" || return 1
  basename "$target"
}

fetch_commit() {
  local sha="$1"
  if [ ! -d "$REPO" ]; then
    git init --quiet --bare "$REPO"
    git -C "$REPO" remote add origin "$ORIGIN"
  fi
  git -C "$REPO" fetch --quiet --no-tags origin '+refs/heads/main:refs/remotes/origin/main'
  git -C "$REPO" cat-file -e "$sha^{commit}" 2>/dev/null ||
    fail "commit $sha was not fetched from origin."
  git -C "$REPO" merge-base --is-ancestor "$sha" refs/remotes/origin/main ||
    fail "commit $sha is not on origin/main; refusing to build it."
}

build_release() {
  local sha="$1" release="$RELEASES/$1"
  if [ -f "$release/.complete" ]; then
    echo "worker-release: release $sha is already built."
    return 0
  fi
  fetch_commit "$sha"
  if [ -e "$release" ]; then
    git -C "$REPO" worktree remove --force "$release/app" 2>/dev/null || true
    rm -rf "$release"
  fi
  git -C "$REPO" worktree prune
  mkdir -p "$release"
  git -C "$REPO" worktree add --quiet --detach "$release/app" "$sha"
  [ "$(git -C "$release/app" rev-parse HEAD)" = "$sha" ] || fail "checkout does not match $sha."

  echo "worker-release: installing application dependencies for $sha"
  (cd "$release/app" && CI=true PUPPETEER_SKIP_DOWNLOAD=1 pnpm install --frozen-lockfile)
  [ -x "$release/app/apps/web/node_modules/.bin/tsx" ] || fail "tsx is missing after the install."

  cp -a "$release/app/vps-workers" "$release/workers"
  cp "$release/app/.github/scripts/gigl-dotenv.sh" "$release/workers/bin/gigl-dotenv.sh"
  printf '%s' "$sha" > "$release/workers/app-checkout.sha"
  echo "worker-release: installing worker dependencies for $sha"
  (cd "$release/workers" && CI=true pnpm install --frozen-lockfile --prod)
  [ -z "$(git -C "$release/app" status --porcelain=v1 --untracked-files=no)" ] ||
    fail "dependency installation modified tracked files."
  touch "$release/.complete"
}

# Points every non-persistent worker entry through the `current` symlink,
# so a single rename switches code while logs, locks and state persist.
link_worker_entries() {
  local release="$1" entry name
  for entry in "$release/workers"/* "$release/workers"/.[!.]*; do
    [ -e "$entry" ] || continue
    name="$(basename "$entry")"
    case "$PERSISTENT_ENTRIES" in *" $name "*) continue ;; esac
    ln -sfn "../current/workers/$name" "$WORKERS/$name"
  done
  ln -sfn ../current/workers/app-checkout.sha "$WORKERS/app-checkout.sha"
  for entry in "$WORKERS"/* "$WORKERS"/.[!.]*; do
    if [ -L "$entry" ] && [ ! -e "$entry" ]; then rm -f "$entry"; fi
  done
}

switch_current() {
  local sha="$1"
  ln -sfn "releases/$sha" "$ROOT/current.next"
  mv -T "$ROOT/current.next" "$ROOT/current"
  ln -sfn current/app "$ROOT/app-live"
  link_worker_entries "$RELEASES/$sha"
}

render_crontab() {
  local deploy_script="$RELEASES/$1/workers/deploy.sh" block
  block="$(sed -n "/^\$CRON_BLOCK_START\$/,/^\$CRON_BLOCK_END\$/p" "$deploy_script")"
  [ -n "$block" ] || fail "the worker schedule block is missing from deploy.sh."
  block="$(printf '%s\n' "$block" | grep -v -E "$REMEDIATION_JOBS" |
    sed -e "s|^\$CRON_BLOCK_START\$|$CRON_BLOCK_START|" -e "s|^\$CRON_BLOCK_END\$|$CRON_BLOCK_END|" \
      -e "s|\$REMOTE_DIR|$WORKERS|g" -e "s|\$NODE_BIN|$NODE_BIN|g")"
  if printf '%s\n' "$block" | grep -q -E '\$\{?[A-Z_]'; then
    fail "the worker schedule has unresolved variables."
  fi
  printf '%s\n' "$block"
}

install_services() {
  local sha="$1" unit job description dir="$HOME/.config/systemd/user"
  mkdir -p "$dir"
  for unit in vercel-log-drain-receiver ai-storefront-trigger import-job-trigger; do
    case "$unit" in
      vercel-log-drain-receiver) job=vercel-log-drain-receiver; description='Vercel log drain receiver' ;;
      ai-storefront-trigger) job=ai-storefront-trigger-server; description='AI storefront trigger server' ;;
      import-job-trigger) job=import-job-trigger-server; description='import job trigger server' ;;
    esac
    cat > "$dir/baci-$unit.service" <<EOF
[Unit]
Description=Baci $description
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$WORKERS
ExecStart=$NODE_BIN $WORKERS/jobs/$job.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  done
  systemctl --user daemon-reload
  systemctl --user enable --quiet baci-vercel-log-drain-receiver.service \
    baci-ai-storefront-trigger.service baci-import-job-trigger.service
  bash "$RELEASES/$sha/workers/install-event-pipeline-services.sh" "$WORKERS"
  bash "$RELEASES/$sha/workers/install-quiz-finalization-service.sh" "$WORKERS"
  # Long-running services keep the release they started from until restarted.
  systemctl --user restart baci-vercel-log-drain-receiver.service \
    baci-ai-storefront-trigger.service baci-import-job-trigger.service \
    baci-domain-event-router.service baci-event-delivery-worker.service \
    baci-quiz-finalization.service
}

install_schedule() {
  local sha="$1" rendered="$ROOT/state.crontab.next"
  render_crontab "$sha" > "$rendered"
  crontab "$rendered"
  # The deploy runner reads this copy; it cannot read another user's spool.
  mv -f "$rendered" "$WORKERS/state/installed-crontab"
}

preflight() {
  (cd "$WORKERS" && "$NODE_BIN" "$WORKERS/jobs/preflight-direct-web-workers.mjs") >/dev/null
}

activate_release() {
  local sha="$1" verify="${2:-verify}" previous=""
  [ -f "$RELEASES/$sha/.complete" ] || fail "release $sha has not been built."
  # Rollback stays possible while GitHub is unreachable; it only selects
  # the release that was verified and live immediately before.
  if [ "$verify" = verify ]; then fetch_commit "$sha"; fi
  previous="$(current_sha || true)"
  mkdir -p "$WORKERS/locks"
  exec 8>"$WORKERS/locks/gigl-tracking.lock"
  flock -w "$LOCK_WAIT" 8 || fail "timed out waiting for the GIGL tracking tick to finish."
  switch_current "$sha"
  if ! preflight; then
    echo "worker-release: preflight failed for $sha; restoring ${previous:-nothing}." >&2
    if [ -n "$previous" ] && [ "$previous" != "$sha" ]; then switch_current "$previous"; fi
    exit 1
  fi
  if [ -n "$previous" ] && [ "$previous" != "$sha" ]; then
    printf '%s\n' "$previous" > "$WORKERS/state/previous-release"
  fi
  flock -u 8
  install_schedule "$sha"
  install_services "$sha"
  prune_releases "$sha" "$previous"
  echo "worker-release: activated $sha."
}

prune_releases() {
  local keep_current="$1" keep_previous="${2:-}" release name
  for release in "$RELEASES"/*; do
    [ -d "$release" ] || continue
    name="$(basename "$release")"
    if [ "$name" = "$keep_current" ] || [ "$name" = "$keep_previous" ]; then continue; fi
    git -C "$REPO" worktree remove --force "$release/app" 2>/dev/null || true
    rm -rf "$release"
  done
  git -C "$REPO" worktree prune
}

rollback_release() {
  local previous
  previous="$(cat "$WORKERS/state/previous-release" 2>/dev/null || true)"
  require_sha "$previous"
  activate_release "$previous" rollback
}

main() {
  local command="${1:-}"
  [ "$(id -un)" != root ] || fail "run this as the worker user, never as root."
  mkdir -p "$RELEASES" "$WORKERS/logs" "$WORKERS/locks" "$WORKERS/state"
  exec 9>"$WORKERS/locks/release.lock"
  flock -w "$LOCK_WAIT" 9 || fail "another worker release is in progress."
  case "$command" in
    build) require_sha "${2:-}"; build_release "$2" ;;
    activate) require_sha "${2:-}"; activate_release "$2" ;;
    rollback) rollback_release ;;
    status) current_sha || fail "no release is active." ;;
    *) fail "usage: worker-release.sh build <sha> | activate <sha> | rollback | status" ;;
  esac
}

main "$@"

#!/usr/bin/env bash
# Deploy VPS workers to bassey@82.29.190.219
# Usage: bash vps-workers/deploy.sh

set -euo pipefail

WORKER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/prepare-worker-release.sh
source "$WORKER_ROOT/lib/prepare-worker-release.sh"
# shellcheck source=lib/install-remediation-cron-transition.sh
source "$WORKER_ROOT/lib/install-remediation-cron-transition.sh"

VPS="bassey@82.29.190.219"
REMOTE_DIR="/home/bassey/baci-workers"
APP_SHA=$(git rev-parse HEAD)
CODEX_REMEDIATOR_IMAGE="baci-codex-remediator:$APP_SHA"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing worker deployment from a dirty tracked checkout." >&2
  exit 1
fi
if [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo "Refusing worker deployment with untracked files." >&2
  exit 1
fi

prepare_worker_release

CODEX_CONTAINER_BIN=$(ssh "$VPS" "find /home/bassey/.local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor -path '*/bin/codex' -type f -print -quit")
CODEX_READONLY_SECCOMP_PROFILE="$REMOTE_DIR/config/codex-readonly-seccomp.json"

if [ -z "$CODEX_CONTAINER_BIN" ]; then
  echo "Unable to resolve the native Codex binary on $VPS." >&2
  exit 1
fi

echo "==> Building isolated Codex remediator image"
ssh "$VPS" "docker build -f $STAGING_DIR/Dockerfile.codex-remediator -t $CODEX_REMEDIATOR_IMAGE $STAGING_DIR"

install_remediation_cron_transition

promote_worker_release

ssh "$VPS" "install -d -m 700 $REMOTE_DIR/locks && touch $REMOTE_DIR/locks/error-remediator-global.lock && chmod 600 $REMOTE_DIR/locks/error-remediator-global.lock"

echo "==> Installing Vercel drain receiver user service"
cat <<EOF | ssh "$VPS" "mkdir -p ~/.config/systemd/user && cat > ~/.config/systemd/user/baci-vercel-log-drain-receiver.service"
[Unit]
Description=Baci Vercel log drain receiver
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR
ExecStart=$NODE_BIN $REMOTE_DIR/jobs/vercel-log-drain-receiver.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
ssh "$VPS" "systemctl --user daemon-reload && systemctl --user enable --now baci-vercel-log-drain-receiver.service && systemctl --user restart baci-vercel-log-drain-receiver.service"

echo "==> Installing AI storefront trigger user service"
cat <<EOF | ssh "$VPS" "mkdir -p ~/.config/systemd/user && cat > ~/.config/systemd/user/baci-ai-storefront-trigger.service"
[Unit]
Description=Baci AI storefront trigger server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR
ExecStart=$NODE_BIN $REMOTE_DIR/jobs/ai-storefront-trigger-server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
ssh "$VPS" "systemctl --user daemon-reload && systemctl --user enable --now baci-ai-storefront-trigger.service"

echo "==> Installing import job trigger user service"
cat <<EOF | ssh "$VPS" "mkdir -p ~/.config/systemd/user && cat > ~/.config/systemd/user/baci-import-job-trigger.service"
[Unit]
Description=Baci import job trigger server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR
ExecStart=$NODE_BIN $REMOTE_DIR/jobs/import-job-trigger-server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
ssh "$VPS" "systemctl --user daemon-reload && systemctl --user enable --now baci-import-job-trigger.service"

echo "==> Installing durable event-pipeline user services"
ssh "$VPS" "bash $REMOTE_DIR/install-event-pipeline-services.sh $REMOTE_DIR"

echo "==> Installing durable quiz finalization user service"
ssh "$VPS" "bash $REMOTE_DIR/install-quiz-finalization-service.sh $REMOTE_DIR"

echo "==> Installing crontab entries on VPS (idempotent)"
CRON_BLOCK_START="# >>> baci-workers >>>"
CRON_BLOCK_END="# <<< baci-workers <<<"
cat <<EOF | ssh "$VPS" "cat > $REMOTE_DIR/crontab.fragment"
$CRON_BLOCK_START
0,30 * * * * flock -n $REMOTE_DIR/locks/push-receipts.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/push-receipts.mjs' >> $REMOTE_DIR/logs/push-receipts.log 2>&1
10 *   * * * flock -n $REMOTE_DIR/locks/cleanup-agentic-request-records.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/cleanup-agentic-request-records.mjs' >> $REMOTE_DIR/logs/cleanup-agentic-request-records.log 2>&1
0 0    * * * flock -n $REMOTE_DIR/locks/cleanup-push-tokens.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/cleanup-push-tokens.mjs' >> $REMOTE_DIR/logs/cleanup-push-tokens.log 2>&1
0 1    * * * flock -n $REMOTE_DIR/locks/cleanup-orders.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/cleanup-orders' >> $REMOTE_DIR/logs/cleanup-orders.log 2>&1
0 3    * * * flock -n $REMOTE_DIR/locks/cleanup-import-uploads.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/cleanup-import-uploads.mjs' >> $REMOTE_DIR/logs/cleanup-import-uploads.log 2>&1
12 *   * * * flock -n $REMOTE_DIR/locks/cleanup-legacy-expense-receipts.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/cleanup-legacy-expense-receipts.mjs' >> $REMOTE_DIR/logs/cleanup-legacy-expense-receipts.log 2>&1
18 *   * * * flock -n $REMOTE_DIR/locks/cleanup-private-expense-receipts.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/cleanup-private-expense-receipts.mjs' >> $REMOTE_DIR/logs/cleanup-private-expense-receipts.log 2>&1
20 3   * * * flock -n $REMOTE_DIR/locks/supabase-retention-cleanup.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/supabase-retention-cleanup.mjs' >> $REMOTE_DIR/logs/supabase-retention-cleanup.log 2>&1
40 3   * * * flock -n $REMOTE_DIR/locks/cleanup-remediation-storage.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/cleanup-remediation-storage.mjs' >> $REMOTE_DIR/logs/cleanup-remediation-storage.log 2>&1
0 5    * * * flock -n $REMOTE_DIR/locks/process-settlements.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/process-settlements' >> $REMOTE_DIR/logs/process-settlements.log 2>&1
*/5 *  * * * flock -n $REMOTE_DIR/locks/order-cancellation-side-effects.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/process-settlements?cancellationsOnly=true' >> $REMOTE_DIR/logs/order-cancellation-side-effects.log 2>&1
*/5 *  * * * flock -n $REMOTE_DIR/locks/reconcile-vtu-processing.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/reconcile-vtu-processing' >> $REMOTE_DIR/logs/reconcile-vtu-processing.log 2>&1
*/5 *  * * * flock -n $REMOTE_DIR/locks/merchant-signup-health.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/merchant-signup-health' >> $REMOTE_DIR/logs/merchant-signup-health.log 2>&1
20 *   * * * flock -n $REMOTE_DIR/locks/reconcile-gateway-paid-orders.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/reconcile-gateway-paid-orders' >> $REMOTE_DIR/logs/reconcile-gateway-paid-orders.log 2>&1
# process-redvault-refunds is intentionally unscheduled: production refund
# recovery requires a separately approved restricted-role transport plus
# provider and operational approval (see
# docs/superpowers/plans/uba-redvault-evidence/recovery-completion.md).
# The route stays manual-only behind CRON_SECRET until then.
* *    * * * flock -n $REMOTE_DIR/locks/petrock-reconcile.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=petrock-reconciliation && cd $REMOTE_DIR && timeout --signal=TERM --kill-after=30s 5m $REMOTE_DIR/bin/process-petrock-reconciliation.sh' >> $REMOTE_DIR/logs/petrock-reconcile.log 2>&1
*/5 * * * * flock -n $REMOTE_DIR/locks/order-notifications.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/order-notifications?batchSize=5' >> $REMOTE_DIR/logs/order-notifications.log 2>&1
*/2 * * * * flock -n $REMOTE_DIR/locks/cache-invalidations.lock bash -lc 'export CACHE_INVALIDATION_STATE_FILE=$REMOTE_DIR/state/cache-invalidations.json && cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-cache-invalidation-cron.mjs' >> $REMOTE_DIR/logs/cache-invalidations.log 2>&1
*/15 * * * * flock -n $REMOTE_DIR/locks/vercel-error-remediator.lock bash -lc 'export BACI_CODEX_DOCKER_IMAGE=$CODEX_REMEDIATOR_IMAGE BACI_CODEX_CONTAINER_BIN=$CODEX_CONTAINER_BIN BACI_CODEX_READONLY_SECCOMP_PROFILE=$CODEX_READONLY_SECCOMP_PROFILE && cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/vercel-error-remediator.mjs' >> $REMOTE_DIR/logs/vercel-error-remediator.log 2>&1
*/5 *  * * * flock -n $REMOTE_DIR/locks/sentry-mobile-error-remediator.lock bash -lc 'export BACI_CODEX_DOCKER_IMAGE=$CODEX_REMEDIATOR_IMAGE BACI_CODEX_CONTAINER_BIN=$CODEX_CONTAINER_BIN BACI_CODEX_READONLY_SECCOMP_PROFILE=$CODEX_READONLY_SECCOMP_PROFILE && cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/sentry-mobile-error-remediator.mjs' >> $REMOTE_DIR/logs/sentry-mobile-error-remediator.log 2>&1
22 4   * * * flock -n $REMOTE_DIR/locks/remediation-codex-canary.lock bash -lc 'export BACI_CODEX_DOCKER_IMAGE=$CODEX_REMEDIATOR_IMAGE BACI_CODEX_CONTAINER_BIN=$CODEX_CONTAINER_BIN BACI_CODEX_READONLY_SECCOMP_PROFILE=$CODEX_READONLY_SECCOMP_PROFILE && cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/remediation-codex-canary.mjs' >> $REMOTE_DIR/logs/remediation-codex-canary.log 2>&1
*/15 * * * * flock -n $REMOTE_DIR/locks/ollama-workload.lock flock -n $REMOTE_DIR/locks/agentic-commerce-health.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/agentic-commerce-health' >> $REMOTE_DIR/logs/agentic-commerce-health.log 2>&1
0 */6  * * * flock -n $REMOTE_DIR/locks/inventory-push-alerts.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/inventory/push-alerts' >> $REMOTE_DIR/logs/inventory-push-alerts.log 2>&1
*/5 *  * * * flock -n $REMOTE_DIR/locks/sync-jumia-orders.lock bash -lc 'export NODE_ENV=production && cd $REMOTE_DIR && $REMOTE_DIR/bin/sync-jumia-orders.sh' >> $REMOTE_DIR/logs/sync-jumia-orders.log 2>&1
17 *   * * * flock -n $REMOTE_DIR/locks/process-import-jobs.lock bash -lc 'export NODE_ENV=production && cd $REMOTE_DIR && $REMOTE_DIR/bin/process-import-jobs.sh' >> $REMOTE_DIR/logs/process-import-jobs.log 2>&1
*/10 * * * * flock -n $REMOTE_DIR/locks/ollama-workload.lock flock -n $REMOTE_DIR/locks/ai-storefront-jobs.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=ai-storefront-jobs && cd $REMOTE_DIR && $REMOTE_DIR/bin/process-ai-storefront-jobs.sh' >> $REMOTE_DIR/logs/ai-storefront-jobs.log 2>&1
* * * * * flock -n $REMOTE_DIR/locks/process-domain-events.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=event-pipeline && cd $REMOTE_DIR && $REMOTE_DIR/bin/process-domain-events.sh --once' >> $REMOTE_DIR/logs/process-domain-events.log 2>&1
* * * * * flock -n $REMOTE_DIR/locks/process-event-deliveries.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=event-pipeline && cd $REMOTE_DIR && $REMOTE_DIR/bin/process-event-deliveries.sh --once' >> $REMOTE_DIR/logs/process-event-deliveries.log 2>&1
0 2    * * * flock -n $REMOTE_DIR/locks/ai-jobs-worker.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/ai-jobs/worker' >> $REMOTE_DIR/logs/ai-jobs-worker.log 2>&1
15 2   * * * flock -n $REMOTE_DIR/locks/sync-petrock-catalog.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/sync-petrock-catalog' >> $REMOTE_DIR/logs/sync-petrock-catalog.log 2>&1
0 6    * * * flock -n $REMOTE_DIR/locks/wallet-payouts.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/wallet-payouts' >> $REMOTE_DIR/logs/wallet-payouts.log 2>&1
0 8    * * * flock -n $REMOTE_DIR/locks/alert-stuck-bnpl.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/alert-stuck-bnpl' >> $REMOTE_DIR/logs/alert-stuck-bnpl.log 2>&1
30 8   1 * * flock -n $REMOTE_DIR/locks/vtu-cashback-summaries.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/vtu-cashback-summaries' >> $REMOTE_DIR/logs/vtu-cashback-summaries.log 2>&1
*/15 * * * * flock -n $REMOTE_DIR/locks/publish-scheduled-posts.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/publish-scheduled-posts' >> $REMOTE_DIR/logs/publish-scheduled-posts.log 2>&1
0 10   * * * flock -n $REMOTE_DIR/locks/storefront-update-nudge.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/storefront-update-nudge' >> $REMOTE_DIR/logs/storefront-update-nudge.log 2>&1
30 9   * * * flock -n $REMOTE_DIR/locks/ios-live-build-sync.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/ios-live-build-sync' >> $REMOTE_DIR/logs/ios-live-build-sync.log 2>&1
45 9   * * * flock -n $REMOTE_DIR/locks/android-live-build-sync.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-web-cron.mjs /api/cron/android-live-build-sync' >> $REMOTE_DIR/logs/android-live-build-sync.log 2>&1
* * * * * flock -n $REMOTE_DIR/locks/quiz-finalize.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=quiz-finalization && cd $REMOTE_DIR && timeout --signal=TERM --kill-after=5s 50s $REMOTE_DIR/bin/process-quiz-finalization.sh --once' >> $REMOTE_DIR/logs/quiz-finalize.log 2>&1
15 4   * * * flock -n $REMOTE_DIR/locks/sync-gigl-service-centres.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/sync-gigl-service-centres.mjs' >> $REMOTE_DIR/logs/sync-gigl-service-centres.log 2>&1
$CRON_BLOCK_END
EOF
ssh "$VPS" "bash -s -- '$REMOTE_DIR/crontab.fragment' '$REMOTE_DIR' '$CRON_BLOCK_START' '$CRON_BLOCK_END'" <<'REMOTE_SH'
set -euo pipefail

fragment_path="$1"
remote_dir="$2"
cron_block_start="$3"
cron_block_end="$4"
tmp_file="$(mktemp /tmp/baci-crontab.XXXXXX)"

cleanup() {
  rm -f "$tmp_file"
}
trap cleanup EXIT

python3 - "$fragment_path" "$remote_dir" "$cron_block_start" "$cron_block_end" > "$tmp_file" <<'PY'
import pathlib
import subprocess
import sys

fragment = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
remote_dir = sys.argv[2]
block_start = sys.argv[3]
block_end = sys.argv[4]

existing = subprocess.run(
    ['crontab', '-l'],
    check=False,
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    text=True,
)
lines = existing.stdout.splitlines() if existing.returncode == 0 else []
filtered = []
inside_block = False
for line in lines:
    if line.strip() == block_start:
        inside_block = True
        continue
    if line.strip() == block_end:
        inside_block = False
        continue
    if inside_block:
        continue

    stripped_line = line.lstrip()
    uses_current_worker_paths = (
        f'{remote_dir}/jobs/' in stripped_line
        or f'{remote_dir}/bin/' in stripped_line
    )
    uses_legacy_relative_worker_paths = (
        f'cd {remote_dir}' in stripped_line
        and (' jobs/' in stripped_line or ' bin/' in stripped_line)
    )
    is_baci_worker_command = (
        f'flock -n {remote_dir}/locks/' in stripped_line
        and (uses_current_worker_paths or uses_legacy_relative_worker_paths)
    )
    if is_baci_worker_command:
        continue
    filtered.append(line)

while filtered and not filtered[-1].strip():
    filtered.pop()

if filtered:
    print('\n'.join(filtered))
    print()
print(fragment.rstrip())
PY

if [ ! -s "$tmp_file" ]; then
  echo "Generated crontab is empty; refusing to install." >&2
  exit 1
fi

if ! grep -Fqx "$cron_block_start" "$tmp_file"; then
  echo "Missing start marker in generated crontab ($tmp_file); refusing to install." >&2
  exit 1
fi

if ! grep -Fqx "$cron_block_end" "$tmp_file"; then
  echo "Missing end marker in generated crontab ($tmp_file); refusing to install." >&2
  exit 1
fi

crontab "$tmp_file"
rm -f "$fragment_path"
REMOTE_SH

echo ""
echo "==> Done."
echo "    Reminder: create $REMOTE_DIR/.env if not already present:"
echo "         NEXT_PUBLIC_SUPABASE_URL=..."
echo "         NEXT_PUBLIC_SUPABASE_ANON_KEY=..."
echo "         SUPABASE_SERVICE_ROLE_KEY=..."
echo "         IMEI_IDENTIFIER_ENCRYPTION_KEY=..."
echo "         PETROCK_API_TOKEN=..."
echo "         PETROCK_API_BASE_URL=https://api.petrock.biz/api/reseller/v1"
echo "         PETROCK_ENABLED=true"
echo "         PETROCK_ENABLED_TIERS=..."
echo "         PETROCK_REMEDIATION_ENABLED=true"
echo "         QUIZ_PHASE=1a"
echo "         QUIZ_PRODUCTION_APPROVED=false"
echo "         QUIZ_RPC_SERVER_SECRET=..."
echo "         QUIZ_DEVICE_HASH_PEPPER=..."
echo "         BACI_REPO_DIR=/opt/baci/app"
echo "         GIGL_BASE_URL=..."
echo "         GIGL_EMAIL=..."
echo "         GIGL_PASSWORD=..."
echo "         EXPO_ACCESS_TOKEN=..."
echo "         JUMIA_CLIENT_ID=..."
echo "         BACI_WEB_BASE_URL=..."
echo "         CRON_SECRET=..."
echo "         VERCEL_ERROR_LOG_PATH=$REMOTE_DIR/logs/vercel-drain.jsonl"
echo "         BACI_REMEDIATION_OUTPUT_DIR=$REMOTE_DIR/logs/vercel-error-remediator"
echo "         BACI_SENTRY_REMEDIATION_OUTPUT_DIR=$REMOTE_DIR/logs/sentry-mobile-error-remediator"
echo "         BACI_REMEDIATION_AUTOFIX_ENABLED=0"
echo "         BACI_REMEDIATION_CANARY_ENABLED=1 # opt in to the daily no-change Codex canary"
echo "         SENTRY_REMEDIATION_AUTH_TOKEN=... # dedicated token with event:read"
echo "         SENTRY_ORG=..."
echo "         SENTRY_PROJECT=..."
echo "         VERCEL_LOG_DRAIN_SECRET=..."
echo "         VERCEL_LOG_DRAIN_RECEIVER_PORT=8787"
echo "         OLLAMA_STOREFRONT_BASE_URL=http://localhost:11434"
echo "         AI_STOREFRONT_GENERATION_ENABLED=false"
echo "         AI_STOREFRONT_TRIGGER_SECRET=..."
echo "         AI_STOREFRONT_TRIGGER_HOST=127.0.0.1"
echo "         AI_STOREFRONT_TRIGGER_PORT=3917"
echo "         IMPORT_JOB_TRIGGER_SECRET=..."
echo "         IMPORT_JOB_TRIGGER_HOST=127.0.0.1"
echo "         IMPORT_JOB_TRIGGER_PORT=3918"
echo "         EVENT_PIPELINE_ENQUEUE_ENABLED=false"
echo "         EVENT_PIPELINE_ROUTING_MODE=disabled"
echo "         EVENT_PIPELINE_ACTIVE_DESTINATIONS="
echo "         EVENT_PIPELINE_CANARY_MERCHANT_IDS="
echo "         EVENT_PIPELINE_DELIVERY_ENABLED=false"
echo "         EVENT_PIPELINE_DISABLE_LEGACY_FANOUT=false"
echo "         EVENT_PIPELINE_ALLOW_UNVERIFIED_TELEMETRY=false"
echo "         EVENT_PIPELINE_MAX_DELIVERY_ATTEMPTS=8"
echo "         EVENT_PIPELINE_DELIVERY_CONCURRENCY=5"
echo "         EVENT_PIPELINE_INGRESS_MAX_READS=5"
echo "         EVENT_DELIVERY_ATTEMPT_RETENTION=\"30 days\""
echo "         EVENT_QUEUE_ARCHIVE_RETENTION=\"30 days\""
echo ""
echo "    Note: the storefront-update-nudge cron reads its config from the WEB"
echo "          (Vercel) env, NOT this worker .env: MOBILE_STOREFRONT_UPDATES_ENABLED,"
echo "          MOBILE_STOREFRONT_{ANDROID,IOS}_LATEST_BUILD and _STORE_URL, plus"
echo "          optional MOBILE_STOREFRONT_UPDATE_MESSAGE (overrides the copy)."
echo "          A missing LATEST_BUILD or _STORE_URL silently skips that platform."

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function readDeployScript() {
  return readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
}

describe('deploy crontab schedules', () => {
  it('schedules the gateway paid-order reconcile drain hourly through run-web-cron', () => {
    const deployScript = readDeployScript();

    assert.match(
      deployScript,
      /20 \*\s+\* \* \* flock -n \$LOCK_DIR\/reconcile-gateway-paid-orders\.lock/
    );
    assert.match(
      deployScript,
      /\$NODE_BIN \$REMOTE_DIR\/jobs\/run-web-cron\.mjs \/api\/cron\/reconcile-gateway-paid-orders/
    );
    assert.match(
      deployScript,
      />> \$REMOTE_DIR\/logs\/reconcile-gateway-paid-orders\.log 2>&1/
    );
  });

  it('schedules the order notification outbox cron through run-web-cron', () => {
    const deployScript = readDeployScript();

    assert.match(
      deployScript,
      /\*\/5 \* \* \* \* flock -n \$LOCK_DIR\/order-notifications\.lock/
    );
    assert.match(
      deployScript,
      /\$NODE_BIN \$REMOTE_DIR\/jobs\/run-web-cron\.mjs \/api\/cron\/order-notifications\?batchSize=5/
    );
    assert.match(
      deployScript,
      />> \$REMOTE_DIR\/logs\/order-notifications\.log 2>&1/
    );
  });

  it('schedules ordered cache invalidation through the bounded Next drainer', () => {
    const deployScript = readDeployScript();

    assert.match(
      deployScript,
      /\*\/2 \* \* \* \* flock -n \$LOCK_DIR\/cache-invalidations\.lock/
    );
    assert.match(deployScript, /run-cache-invalidation-cron\.mjs/);
    assert.match(
      deployScript,
      /export CACHE_INVALIDATION_STATE_FILE=\$REMOTE_DIR\/state\/cache-invalidations\.json/
    );
    assert.doesNotMatch(deployScript, /process-storefront-purge-outbox/);
  });

  it('schedules the agentic commerce health cron through run-web-cron', () => {
    const deployScript = readDeployScript();

    assert.match(
      deployScript,
      /\*\/15 \* \* \* \* flock -n \$LOCK_DIR\/ollama-workload\.lock flock -n \$LOCK_DIR\/agentic-commerce-health\.lock/
    );
    assert.match(
      deployScript,
      /\$NODE_BIN \$REMOTE_DIR\/jobs\/run-web-cron\.mjs \/api\/cron\/agentic-commerce-health/
    );
    assert.match(
      deployScript,
      />> \$REMOTE_DIR\/logs\/agentic-commerce-health\.log 2>&1/
    );
  });

  it('schedules the merchant signup policy health check every five minutes', () => {
    const deployScript = readDeployScript();

    assert.match(
      deployScript,
      /\*\/5 \*\s+\* \* \* flock -n \$LOCK_DIR\/merchant-signup-health\.lock/
    );
    assert.match(
      deployScript,
      /\$NODE_BIN \$REMOTE_DIR\/jobs\/run-web-cron\.mjs \/api\/cron\/merchant-signup-health/
    );
    assert.match(
      deployScript,
      />> \$REMOTE_DIR\/logs\/merchant-signup-health\.log 2>&1/
    );
  });

  it('schedules the storefront update nudge daily through run-web-cron', () => {
    const deployScript = readDeployScript();

    assert.match(
      deployScript,
      /0 10 {3}\* \* \* flock -n \$LOCK_DIR\/storefront-update-nudge\.lock/
    );
    assert.match(
      deployScript,
      /\$NODE_BIN \$REMOTE_DIR\/jobs\/run-web-cron\.mjs \/api\/cron\/storefront-update-nudge/
    );
    assert.match(
      deployScript,
      />> \$REMOTE_DIR\/logs\/storefront-update-nudge\.log 2>&1/
    );
  });

  it('schedules the Petrock catalog sync nightly through run-web-cron', () => {
    const deployScript = readDeployScript();

    assert.match(
      deployScript,
      /15 2\s+\* \* \* flock -n \$LOCK_DIR\/sync-petrock-catalog\.lock/
    );
    assert.match(
      deployScript,
      /run-web-cron\.mjs \/api\/cron\/sync-petrock-catalog/
    );
  });

  it('schedules Petrock reconciliation directly every minute with its existing lock and log', () => {
    const deployScript = readDeployScript();
    const cronLine = deployScript
      .split('\n')
      .find((line) => line.includes('petrock-reconcile.lock'));

    assert.ok(cronLine);
    assert.match(
      cronLine,
      /^\* \*\s+\* \* \* flock -n \$LOCK_DIR\/petrock-reconcile\.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=petrock-reconciliation && cd \$REMOTE_DIR && timeout --signal=TERM --kill-after=30s 5m \$REMOTE_DIR\/bin\/process-petrock-reconciliation\.sh' >> \$REMOTE_DIR\/logs\/petrock-reconcile\.log 2>&1$/
    );
    assert.doesNotMatch(
      cronLine,
      /run-web-cron|\/api\/cron\/petrock-reconcile/
    );
  });

  it('does not schedule quiz finalization after migration to its system service', () => {
    const deployScript = readDeployScript();
    assert.doesNotMatch(deployScript, /quiz-finalize\.lock|process-quiz-finalization\.sh|\/api\/quiz\/finalize/);
  });

  it('schedules bounded remediation storage cleanup', () => {
    const deployScript = readDeployScript();

    assert.match(
      deployScript,
      /40 3\s+\* \* \* flock -n \$LOCK_DIR\/cleanup-remediation-storage\.lock/
    );
    assert.match(
      deployScript,
      /\$NODE_BIN \$REMOTE_DIR\/jobs\/cleanup-remediation-storage\.mjs/
    );
    assert.match(
      deployScript,
      />> \$REMOTE_DIR\/logs\/cleanup-remediation-storage\.log 2>&1/
    );
  });

  it('keeps the REDVAULT refund worker unscheduled until restricted-role approval', () => {
    const deployScript = readDeployScript();

    assert.doesNotMatch(
      deployScript,
      /^\s*(\*\/\d+|\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+.*process-redvault-refunds/m
    );
    assert.match(
      deployScript,
      /process-redvault-refunds stays unscheduled/
    );
  });

  it('restarts the drain receiver after promotion before installing cleanup cron', () => {
    const deployScript = readDeployScript();
    const servicesScript = readFileSync(
      join(workerRoot, 'lib', 'install-worker-services.sh'),
      'utf8'
    );
    const servicesIndex = deployScript.indexOf('install_worker_services');
    const crontabIndex = deployScript.indexOf(
      'Installing crontab entries on VPS'
    );

    assert.notEqual(servicesIndex, -1);
    assert.notEqual(crontabIndex, -1);
    assert.ok(servicesIndex < crontabIndex);
    assert.match(
      servicesScript,
      /systemctl --user restart baci-vercel-log-drain-receiver\.service/
    );
  });
});

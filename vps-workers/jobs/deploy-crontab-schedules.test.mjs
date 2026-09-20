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
      /20 \*\s+\* \* \* flock -n \$REMOTE_DIR\/locks\/reconcile-gateway-paid-orders\.lock/
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
      /\*\/5 \* \* \* \* flock -n \$REMOTE_DIR\/locks\/order-notifications\.lock/
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
      /\*\/2 \* \* \* \* flock -n \$REMOTE_DIR\/locks\/cache-invalidations\.lock/
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
      /\*\/15 \* \* \* \* flock -n \$REMOTE_DIR\/locks\/ollama-workload\.lock flock -n \$REMOTE_DIR\/locks\/agentic-commerce-health\.lock/
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
      /\*\/5 \*\s+\* \* \* flock -n \$REMOTE_DIR\/locks\/merchant-signup-health\.lock/
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
      /0 10 {3}\* \* \* flock -n \$REMOTE_DIR\/locks\/storefront-update-nudge\.lock/
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
      /15 2\s+\* \* \* flock -n \$REMOTE_DIR\/locks\/sync-petrock-catalog\.lock/
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
      /^\* \*\s+\* \* \* flock -n \$REMOTE_DIR\/locks\/petrock-reconcile\.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=petrock-reconciliation && cd \$REMOTE_DIR && timeout --signal=TERM --kill-after=30s 5m \$REMOTE_DIR\/bin\/process-petrock-reconciliation\.sh' >> \$REMOTE_DIR\/logs\/petrock-reconcile\.log 2>&1$/
    );
    assert.doesNotMatch(
      cronLine,
      /run-web-cron|\/api\/cron\/petrock-reconcile/
    );
  });

  it('retains a bounded once-only quiz finalization fallback with its existing lock', () => {
    const deployScript = readDeployScript();
    const cronLine = deployScript
      .split('\n')
      .find((line) => line.includes('quiz-finalize.lock'));

    assert.ok(cronLine);
    assert.match(
      cronLine,
      /^\* \* \* \* \* flock -n \$REMOTE_DIR\/locks\/quiz-finalize\.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=quiz-finalization && cd \$REMOTE_DIR && timeout --signal=TERM --kill-after=5s 50s \$REMOTE_DIR\/bin\/process-quiz-finalization\.sh --once' >> \$REMOTE_DIR\/logs\/quiz-finalize\.log 2>&1$/
    );
    assert.doesNotMatch(cronLine, /run-web-cron|\/api\/quiz\/finalize/);
  });

  it('schedules bounded remediation storage cleanup', () => {
    const deployScript = readDeployScript();

    assert.match(
      deployScript,
      /40 3\s+\* \* \* flock -n \$REMOTE_DIR\/locks\/cleanup-remediation-storage\.lock/
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

  it('schedules the REDVAULT refund worker every five minutes', () => {
    const deployScript = readDeployScript();

    assert.match(
      deployScript,
      /\*\/5 \*\s+\* \* \* flock -n \$REMOTE_DIR\/locks\/process-redvault-refunds\.lock/
    );
    assert.match(
      deployScript,
      /\$NODE_BIN \$REMOTE_DIR\/jobs\/run-web-cron\.mjs \/api\/cron\/process-redvault-refunds/
    );
    assert.match(
      deployScript,
      />> \$REMOTE_DIR\/logs\/process-redvault-refunds\.log 2>&1/
    );
  });

  it('restarts the drain receiver after promotion before installing cleanup cron', () => {
    const deployScript = readDeployScript();
    const restartIndex = deployScript.indexOf(
      'systemctl --user restart baci-vercel-log-drain-receiver.service'
    );
    const crontabIndex = deployScript.indexOf(
      'Installing crontab entries on VPS'
    );

    assert.notEqual(restartIndex, -1);
    assert.notEqual(crontabIndex, -1);
    assert.ok(restartIndex < crontabIndex);
  });
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function readDeployScript() {
  return readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
}

describe('deploy crontab schedules', () => {
  it('schedules the gated Oxygen callback drain every five minutes', () => {
    const script = readDeployScript();
    assert.match(
      script,
      /\*\/5 \* \* \* \* flock -n \$REMOTE_DIR\/locks\/oxygen-callback-reconciliation\.lock/
    );
    assert.match(
      script,
      /run-web-cron\.mjs \/api\/cron\/oxygen-callback-reconciliation/
    );
  });
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

  it('schedules the dark PiggyVest daily reconciliation once a day through run-web-cron', () => {
    const deployScript = readDeployScript();
    const lines = deployScript
      .split('\n')
      .filter((line) => line.includes('piggyvest-daily-reconciliation'));

    assert.equal(lines.length, 1);
    assert.match(
      lines[0],
      // The early-cancel interest forfeit sweep runs right after the report,
      // as its own route with its own time budget (deploy.sh is at its line
      // limit, so it shares this entry); either one failing fails the line.
      /^0 23 {2}\* \* \* flock -n \$REMOTE_DIR\/locks\/piggyvest-daily-reconciliation\.lock bash -lc 'cd \$REMOTE_DIR && if \$NODE_BIN \$REMOTE_DIR\/jobs\/run-web-cron\.mjs \/api\/cron\/piggyvest-daily-reconciliation; then \$NODE_BIN \$REMOTE_DIR\/jobs\/run-web-cron\.mjs \/api\/cron\/piggyvest-goal-cancel-forfeit-sweep; else \$NODE_BIN \$REMOTE_DIR\/jobs\/run-web-cron\.mjs \/api\/cron\/piggyvest-goal-cancel-forfeit-sweep; false; fi' >> \$REMOTE_DIR\/logs\/piggyvest-daily-reconciliation\.log 2>&1$/
    );
  });

  // Regression: the line is rendered through an unquoted heredoc, so a shell
  // variable in it ($s, $?) was filled in at deploy time and broke the entry.
  // Render it the same way and run it: both jobs always run, and the line
  // fails if either one fails.
  it('renders the PiggyVest 23:00 line into a command that runs both jobs and fails if either fails', () => {
    const line = readDeployScript()
      .split('\n')
      .find((entry) => entry.includes('piggyvest-daily-reconciliation'));
    const dir = mkdtempSync(join(tmpdir(), 'pv-cron-'));
    const node = join(dir, 'node');
    writeFileSync(
      node,
      '#!/bin/sh\necho "$2" >> "$PV_LOG"\ncase "$2" in *reconciliation) exit "$PV_A";; *) exit "$PV_B";; esac\n'
    );
    chmodSync(node, 0o755);
    const rendered = spawnSync(
      'bash',
      ['-c', `REMOTE_DIR=${dir}; NODE_BIN=${node}; cat <<EOF\n${line}\nEOF`],
      { encoding: 'utf8' }
    ).stdout;
    const command = /bash -lc '([^']*)'/.exec(rendered)?.[1];
    assert.ok(command, rendered);
    for (const [a, b, expected] of [
      ['0', '0', 0],
      ['1', '0', 1],
      ['0', '1', 1],
      ['1', '1', 1],
    ]) {
      const log = join(dir, `log-${a}${b}`);
      const run = spawnSync('bash', ['-c', command], {
        env: { ...process.env, PV_A: a, PV_B: b, PV_LOG: log },
      });
      assert.equal(run.status === 0 ? 0 : 1, expected, `${a}/${b}`);
      assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2);
    }
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

  it('schedules the shared-cart notice delivery alarm every five minutes', () => {
    const deployScript = readDeployScript();

    assert.match(
      deployScript,
      /\*\/5 \*\s+\* \* \* flock -n \$REMOTE_DIR\/locks\/cart-notice-health\.lock/
    );
    assert.match(
      deployScript,
      /\$NODE_BIN \$REMOTE_DIR\/jobs\/run-web-cron\.mjs \/api\/cron\/cart-notice-health/
    );
    assert.match(
      deployScript,
      />> \$REMOTE_DIR\/logs\/cart-notice-health\.log 2>&1/
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

  it('keeps the REDVAULT refund worker unscheduled until restricted-role approval', () => {
    const deployScript = readDeployScript();

    assert.doesNotMatch(
      deployScript,
      /^\s*(\*\/\d+|\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+.*process-redvault-refunds/m
    );
    assert.match(deployScript, /process-redvault-refunds stays unscheduled/);
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

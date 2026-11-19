import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function readDeployScript() {
  return readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
}

describe('deploy crontab worker profiles', () => {
  it('exports non-agentic BACI_WORKER_PROFILE on sync-jumia-orders and process-import-jobs cron lines', () => {
    const deployScript = readDeployScript();

    assert.match(
      deployScript,
      /export BACI_WORKER_PROFILE=jumia-order-sync && cd \$REMOTE_DIR && \$REMOTE_DIR\/bin\/sync-jumia-orders\.sh/
    );
    assert.match(
      deployScript,
      /export BACI_WORKER_PROFILE=import-jobs && cd \$REMOTE_DIR && \$REMOTE_DIR\/bin\/process-import-jobs\.sh/
    );
  });
});

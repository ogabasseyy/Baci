import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runRemediationWorker } from './remediation-worker.test-harness.mjs';

describe('remediation worker test harness', () => {
  it('rejects a caller-supplied lock that is not the harness lock', async () => {
    let loaded = false;

    await assert.rejects(
      runRemediationWorker({
        candidateLoader: () => {
          loaded = true;
          return [];
        },
        env: { BACI_REMEDIATION_AUTOFIX_ENABLED: '1' },
        remediationLock: {},
        workerName: 'test-remediator',
      }),
      /global remediation flock/
    );

    assert.equal(loaded, false);
  });
});

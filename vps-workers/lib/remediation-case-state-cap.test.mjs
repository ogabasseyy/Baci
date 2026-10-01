import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createRemediationCaseState } from './remediation-case-state.mjs';
import { runRemediationWorker } from './remediation-worker.test-harness.mjs';

function candidate(fingerprint, lastSeen) {
  return {
    category: 'sentry_issue',
    fingerprint,
    lastSeen,
    occurrences: 2,
    sample: { issueId: fingerprint, source: 'sentry' },
    source: 'sentry',
  };
}

describe('remediation case cap', () => {
  it('does not throw or select an older observation pruned by the case cap', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'baci-case-cap-'));
    const casePath = join(outputDir, 'case-state.autofix.json');
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-03T10:00:00.000Z'),
      path: casePath,
    });
    const newerCases = Array.from({ length: 1_000 }, (_, index) =>
      candidate(
        `newer-${index}`,
        new Date(Date.parse('2026-08-02T00:00:00.000Z') + index).toISOString()
      )
    );
    state.reconcile(newerCases);
    let autofixAttempts = 0;

    const result = await runRemediationWorker({
      autofixRunner: () => {
        autofixAttempts += 1;
        return { type: 'no_changes' };
      },
      candidateLoader: async () => [
        candidate('older-pruned', '2026-08-01T00:00:00.000Z'),
      ],
      env: {
        BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
        BACI_REMEDIATION_OUTPUT_DIR: outputDir,
      },
      logger: { error: () => undefined, log: () => undefined },
      now: () => Date.parse('2026-08-03T10:00:00.000Z'),
      workerName: 'case-cap-remediator',
    });

    assert.equal(autofixAttempts, 0);
    assert.deepEqual(result.candidates, []);
    assert.equal(
      createRemediationCaseState({ path: casePath }).snapshot().cases[
        'sentry:sentry_issue:older-pruned'
      ],
      undefined
    );
  });
});

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runRemediationWorker } from './remediation-worker.test-harness.mjs';

describe('remediation worker container identity', () => {
  it('passes a validated container identity into autofix', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-worker-identity-'));
    let received;

    await runRemediationWorker({
      autofixRunner: ({ containerIdentity }) => {
        received = containerIdentity;
        return { type: 'no_changes' };
      },
      candidateLoader: async () => [
        {
          fingerprint: 'identity-check',
          occurrences: 2,
          sample: { source: 'sentry' },
        },
      ],
      containerIdentity: { gid: 1002, uid: 1001 },
      env: {
        BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
      },
      workerName: 'test-remediator',
    });

    assert.deepEqual(received, { gid: 1002, uid: 1001 });
  });

  it('rejects a root container identity before autofix starts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-worker-root-id-'));
    let attempted = false;

    await assert.rejects(
      runRemediationWorker({
        autofixRunner: () => {
          attempted = true;
          return { type: 'no_changes' };
        },
        candidateLoader: async () => [
          {
            fingerprint: 'root-identity',
            occurrences: 2,
            sample: { source: 'sentry' },
          },
        ],
        containerIdentity: { gid: 1001, uid: 0 },
        env: {
          BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
          BACI_REMEDIATION_OUTPUT_DIR: directory,
        },
        workerName: 'test-remediator',
      }),
      /requires a non-root worker uid and gid/
    );
    assert.equal(attempted, false);
  });

  it('supplies a deterministic non-root identity when none is given', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-worker-default-id-'));
    let received;

    await runRemediationWorker({
      autofixRunner: ({ containerIdentity }) => {
        received = containerIdentity;
        return { type: 'no_changes' };
      },
      candidateLoader: async () => [
        {
          fingerprint: 'default-identity',
          occurrences: 2,
          sample: { source: 'sentry' },
        },
      ],
      env: {
        BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
      },
      workerName: 'test-remediator',
    });

    assert.deepEqual(received, { gid: 1001, uid: 1001 });
  });
});

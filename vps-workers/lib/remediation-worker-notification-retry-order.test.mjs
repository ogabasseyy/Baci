import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { createRemediationState } from './remediation-state.mjs';
import { runRemediationWorker } from './remediation-worker.test-harness.mjs';

it('acknowledges a queued notification before propagating a provider loader outage', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-worker-notification-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const nowMs = Date.parse('2026-08-09T10:00:00.000Z');
  const now = () => nowMs;
  const statePath = join(directory, 'handled-state.dry-run.json');
  const state = createRemediationState({ now, path: statePath });
  state.complete({
    notification: {
      id: 'queued-notification',
      report: { html: '<p>queued</p>', subject: 'queued', text: 'queued' },
    },
  });
  let sends = 0;

  await assert.rejects(
    runRemediationWorker({
      candidateLoader: () => Promise.reject(new Error('provider unavailable')),
      env: {
        BACI_REMEDIATION_NOTIFY_EMAILS: 'ops@example.com',
        BACI_REMEDIATION_OUTPUT_DIR: directory,
        ZEPTOMAIL_TOKEN: 'token',
      },
      fetchFn: () => {
        sends += 1;
        return Promise.resolve(new Response('', { status: 200 }));
      },
      logger: { error: () => undefined, log: () => undefined },
      now,
      workerName: 'test-remediator',
    }),
    /provider unavailable/
  );

  assert.equal(sends, 1);
  assert.deepEqual(
    createRemediationState({ now, path: statePath }).notifications(),
    []
  );
});

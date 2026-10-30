import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { acquireWorkerReleaseQuiescence, workerReleaseQuiescePolicy } from './worker-release-quiesce-adapter.mjs';

describe('worker release quiescence adapter', () => {
  it('fails closed instead of reporting quiescence without validated worker context', async () => {
    await assert.rejects(
      acquireWorkerReleaseQuiescence(),
      /quiescence is not established; refusing promotion or rollback/
    );
  });

  it('remains explicitly disabled while production and broker worker identities differ', () => {
    assert.equal(workerReleaseQuiescePolicy.enabled, false);
    assert.equal(workerReleaseQuiescePolicy.workerRoot, '/srv/baci-workers');
    assert.equal(workerReleaseQuiescePolicy.expectedWorker, 'baci-worker');
    assert.equal(workerReleaseQuiescePolicy.legacyProductionRoot, '/home/bassey/baci-workers');
    assert.equal(workerReleaseQuiescePolicy.legacyProductionUid, 1001);
    assert.equal(workerReleaseQuiescePolicy.legacyUserBus, '/run/user/1001/bus');
  });

  it('cannot invoke the legacy helper as root or trust a caller-supplied command', () => {
    const source = readFileSync(new URL('./worker-release-quiesce-adapter.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /child_process|spawn\s*\(|systemctl|crontab/);
    assert.match(source, /enabled: false/);
  });
});

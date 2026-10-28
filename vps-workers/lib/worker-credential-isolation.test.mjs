import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateWorkerCredentialIsolation,
  WORKER_CREDENTIAL_ISOLATION_PATHS,
} from './worker-credential-isolation.mjs';

function passingObservation() {
  return {
    accounts: { release: true, worker: true },
    groups: { release: ['baci-release'], worker: ['baci-worker'] },
    access: {
      releaseReadsGithubCredential: false,
      workerReadsGithubCredential: false,
      workerWritesGithubCredential: false,
      workerReadsReleaseWorkspace: false,
      releaseReadsWorkerEnvironment: false,
      releaseWritesWorkerRoot: false,
      workerReadsWorkerEnvironment: true,
    },
  };
}

describe('worker credential isolation contract', () => {
  it('accepts the dedicated, isolated release and worker identities', () => {
    assert.deepEqual(evaluateWorkerCredentialIsolation(passingObservation()), {
      ok: true,
      failures: [],
    });
  });

  it('rejects identity group overlap and every forbidden file access', () => {
    const observation = passingObservation();
    observation.groups.release.push('docker');
    observation.groups.worker.push('sudo');
    for (const key of Object.keys(observation.access)) {
      observation.access[key] = !observation.access[key];
    }

    const result = evaluateWorkerCredentialIsolation(observation);
    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 9);
  });

  it('fails closed when observations are incomplete', () => {
    const result = evaluateWorkerCredentialIsolation({});
    assert.equal(result.ok, false);
    assert.ok(result.failures.length >= 9);
  });

  it('pins the probes to the approved account and credential boundary paths', () => {
    assert.equal(WORKER_CREDENTIAL_ISOLATION_PATHS.githubCredential, '/home/bassey/.config/gh/hosts.yml');
    assert.equal(WORKER_CREDENTIAL_ISOLATION_PATHS.releaseWorkspace, '/home/baci-release/actions-runner/_work');
    assert.equal(WORKER_CREDENTIAL_ISOLATION_PATHS.workerRoot, '/srv/baci-workers');
    assert.equal(WORKER_CREDENTIAL_ISOLATION_PATHS.workerEnvironment, '/srv/baci-workers/runtime/worker.env');
  });
});

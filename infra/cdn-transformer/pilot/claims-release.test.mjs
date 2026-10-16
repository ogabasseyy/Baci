import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  acquireClaim,
  claimKeyForJob,
  createRunToken,
  releaseClaim,
} from './claims.mjs';

const JOB = {
  assetId: 'logo-1',
  expectedSha256: 'd'.repeat(64),
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  role: 'logo',
  schemaVersion: 1,
  sourcePath: 'logo-1.png',
};

test('release never deletes a successor claim published over a stale one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pilot-claims-'));
  const token = createRunToken();
  await acquireClaim(root, JOB, token);
  // A successor claim lands (simulated handoff): the stale release must
  // refuse without unlinking it. Read-then-unlink would delete exactly
  // these bytes.
  const path = join(root, 'claims', `${claimKeyForJob(JOB)}.json`);
  const successor = JSON.stringify({
    ownerStartedAtMs: Date.now(),
    pid: process.pid,
    runToken: createRunToken(),
    stagingDirName: 'staging-successor',
  });
  await writeFile(path, successor);
  await assert.rejects(() => releaseClaim(root, JOB, token), /foreign/);
  assert.equal(await readFile(path, 'utf8'), successor);
  // The atomic release moves the pathname aside first: a foreign claim
  // is restored in place, leaving no releasing- temp behind.
  assert.deepEqual(await readdir(join(root, 'claims')), [
    `${claimKeyForJob(JOB)}.json`,
  ]);
});

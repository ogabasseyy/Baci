import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireClaim,
  claimKeyForJob,
  createRunToken,
  recoverAbandonedClaim,
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

async function outputRoot() {
  return mkdtemp(join(tmpdir(), 'pilot-claims-'));
}

async function deadPid() {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['-e', '']);
  await new Promise((resolve) => child.once('exit', resolve));
  return child.pid;
}

test('acquire creates an exclusive claim bound to this process', async () => {
  const root = await outputRoot();
  const token = createRunToken();
  const claim = await acquireClaim(root, JOB, token);
  assert.equal(claim.runToken, token);
  assert.equal(claim.pid, process.pid);
  assert.match(claim.stagingDirName, /^staging-/);
  const stored = JSON.parse(
    await readFile(join(root, 'claims', `${claimKeyForJob(JOB)}.json`), 'utf8')
  );
  assert.equal(stored.runToken, token);
});

test('a live claim is reported, never stolen', async () => {
  const root = await outputRoot();
  const token = createRunToken();
  await acquireClaim(root, JOB, token);
  const error = await acquireClaim(root, JOB, createRunToken()).catch(
    (value) => value
  );
  assert.equal(error.code, 'claim-held');
  assert.equal(error.ownerPid, process.pid);
});

test('release removes only the matching run token', async () => {
  const root = await outputRoot();
  const token = createRunToken();
  const claim = await acquireClaim(root, JOB, token);
  await assert.rejects(() => releaseClaim(root, JOB, 'foreign-token'), /foreign/);
  await releaseClaim(root, JOB, token);
  // Idempotent second release.
  await releaseClaim(root, JOB, token);
  // Re-acquire works after release.
  const again = await acquireClaim(root, JOB, createRunToken());
  assert.equal(again.jobKey, claim.jobKey);
});

test('abandoned claims recover only after the owner provably exited', async () => {
  const root = await outputRoot();
  const pid = await deadPid();
  const token = `dead-run-${pid}`;
  const stagingDirName = `staging-${token}`;
  await mkdir(join(root, 'claims'), { recursive: true });
  await mkdir(join(root, stagingDirName), { recursive: true });
  await writeFile(
    join(root, 'claims', `${claimKeyForJob(JOB)}.json`),
    JSON.stringify({
      createdAt: new Date().toISOString(),
      jobKey: 'x',
      pid,
      runToken: token,
      stagingDirName,
    })
  );
  const recovered = await recoverAbandonedClaim(root, JOB);
  assert.equal(recovered.runToken, token);
  assert.equal(recovered.removedStaging, true);
  const reacquired = await acquireClaim(root, JOB, createRunToken());
  assert.ok(reacquired.runToken);
});

test('PID reuse never steals a live claimant', async () => {
  const root = await outputRoot();
  // Foreign token on OUR live pid: indistinguishable from a live owner, so
  // recovery must refuse even though the token is not ours.
  const stagingDirName = 'staging-live-foreign';
  await mkdir(join(root, 'claims'), { recursive: true });
  await mkdir(join(root, stagingDirName), { recursive: true });
  await writeFile(
    join(root, 'claims', `${claimKeyForJob(JOB)}.json`),
    JSON.stringify({
      createdAt: new Date().toISOString(),
      jobKey: 'x',
      pid: process.pid,
      runToken: 'live-foreign-token',
      stagingDirName,
    })
  );
  const error = await recoverAbandonedClaim(root, JOB).catch((value) => value);
  assert.equal(error.code, 'claim-held');
  // The live run's staging is untouched.
  const { stat } = await import('node:fs/promises');
  assert.ok((await stat(join(root, stagingDirName))).isDirectory());
});

test('corrupt claims are reported, not auto-deleted', async () => {
  const root = await outputRoot();
  await mkdir(join(root, 'claims'), { recursive: true });
  await writeFile(
    join(root, 'claims', `${claimKeyForJob(JOB)}.json`),
    '{not-json'
  );
  const error = await acquireClaim(root, JOB, createRunToken()).catch(
    (value) => value
  );
  assert.equal(error.code, 'claim-corrupt');
});

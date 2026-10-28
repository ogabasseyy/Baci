import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  acquireProductionReleaseLock,
  assertCacheWorkerActionLockOwner,
  assertNoopPublicationOutcome,
  clearNoopProductionReleaseLock,
  clearProductionReleaseLock,
  markProductionReleasePublishing,
  readProductionReleaseLock,
  validateProductionLockHost,
  verifyLiveAliasAndWorker,
} from './production-release-lock.mjs';

const release = { run_id: '42', run_attempt: 1, sha: 'a'.repeat(40) };

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'baci-release-lock-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'lock.json');
}

test('creates a private lock bound to the exact workflow run, attempt and SHA', (t) => {
  const path = fixture(t);
  assert.deepEqual(acquireProductionReleaseLock(path, release), release);
  assert.deepEqual(readProductionReleaseLock(path), { ...release, state: 'worker_syncing', workflow: '.github/workflows/production-release.yml' });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.throws(() => acquireProductionReleaseLock(path, release), /already exists/);
});

test('leaves an indeterminate or failed release locked until a matching owner finalizes it', (t) => {
  const path = fixture(t);
  acquireProductionReleaseLock(path, release);
  assert.throws(() => markProductionReleasePublishing(path, { ...release, sha: 'b'.repeat(40) }), /owner mismatch/);
  markProductionReleasePublishing(path, release);
  assert.equal(readProductionReleaseLock(path).state, 'publishing');
  assert.throws(() => clearProductionReleaseLock(path, { ...release, run_attempt: 2 }), /owner mismatch/);
  assert.equal(readProductionReleaseLock(path).state, 'publishing');
  clearProductionReleaseLock(path, release);
  assert.equal(readProductionReleaseLock(path), null);
});

test('rejects malformed, weak, symlinked and unsafe lock state without clearing it', (t) => {
  const path = fixture(t);
  acquireProductionReleaseLock(path, release);
  assert.throws(() => clearProductionReleaseLock(path, { ...release, run_id: '99' }), /owner mismatch/);
  assert.match(readFileSync(path, 'utf8'), /worker_syncing/);
  assert.throws(() => acquireProductionReleaseLock(`${path}/child`, release));
});

test('clears a no-op lock only when the caller reusable-workflow output says publication was skipped', () => {
  assert.equal(assertNoopPublicationOutcome('false'), undefined);
  for (const forgedOrAmbiguous of ['true', '', undefined, 'skipped', 'success']) {
    assert.throws(() => assertNoopPublicationOutcome(forgedOrAmbiguous), /did not prove that app publication was skipped/);
  }
});

test('clears a no-op lock using the authenticated workflow run identity', (t) => {
  const path = fixture(t);
  acquireProductionReleaseLock(path, release);
  const auth = { claims: { run_id: release.run_id, run_attempt: String(release.run_attempt), sha: release.sha } };

  assert.equal(clearNoopProductionReleaseLock({
    env: { BACI_APP_PUBLICATION_SUCCEEDED: 'false' },
    auth,
    lockPath: path,
  }), undefined);
  assert.equal(readProductionReleaseLock(path), null);
});

test('no-op finalizer retains a lock if its authenticated identity does not own it', (t) => {
  const path = fixture(t);
  acquireProductionReleaseLock(path, release);

  assert.throws(() => clearNoopProductionReleaseLock({
    env: { BACI_APP_PUBLICATION_SUCCEEDED: 'false' },
    auth: { claims: { run_id: '99', run_attempt: '1', sha: release.sha } },
    lockPath: path,
  }), /owner mismatch/);
  assert.equal(readProductionReleaseLock(path).run_id, release.run_id);
});

test('cache worker action requires the exact active release lock owner and run SHA', (t) => {
  const path = fixture(t);
  acquireProductionReleaseLock(path, release);
  const auth = { claims: { run_id: release.run_id, run_attempt: String(release.run_attempt), sha: release.sha } };
  assert.deepEqual(assertCacheWorkerActionLockOwner({ auth, lockPath: path }), release);
  for (const claims of [
    { ...auth.claims, run_id: '99' },
    { ...auth.claims, run_attempt: '2' },
    { ...auth.claims, sha: 'b'.repeat(40) },
  ]) {
    assert.throws(() => assertCacheWorkerActionLockOwner({ auth: { claims }, lockPath: path }), /exact active production release lock owner/);
  }
  assert.equal(readProductionReleaseLock(path).state, 'worker_syncing');
  markProductionReleasePublishing(path, release);
  assert.throws(() => assertCacheWorkerActionLockOwner({ auth, lockPath: path }), /exact active production release lock owner/);
  assert.equal(readProductionReleaseLock(path).state, 'publishing');
});

test('restricts lock operations to the verified runner host and UID', () => {
  assert.equal(validateProductionLockHost({ username: 'baci-release', uid: 2042, expectedUid: 2042, home: '/home/baci-release', host: 'ogabassey' }), undefined);
  assert.throws(() => validateProductionLockHost({ username: 'bassey', uid: 1001, expectedUid: 1001, home: '/home/bassey', host: 'ogabassey' }), /verified baci-release identity/);
  assert.throws(() => validateProductionLockHost({ username: 'baci-release', uid: 0, expectedUid: 0, home: '/home/baci-release', host: 'ogabassey' }), /verified baci-release identity/);
  assert.throws(() => validateProductionLockHost({ username: 'baci-release', uid: 2042, expectedUid: 2043, home: '/home/baci-release', host: 'ogabassey' }), /verified baci-release identity/);
  assert.throws(() => validateProductionLockHost({ username: 'baci-release', uid: 2042, expectedUid: 2042, home: '/home/other', host: 'ogabassey' }), /verified baci-release identity/);
  assert.throws(() => validateProductionLockHost({ username: 'baci-release', uid: 2042, expectedUid: 2042, home: '/home/baci-release', host: 'attacker' }), /verified baci-release identity/);
});

test('publisher releases the durable lock only after worker SHA, Vercel alias, deployment and current main agree', async (t) => {
  const path = fixture(t);
  acquireProductionReleaseLock(path, release);
  const auth = {
    claims: { run_id: release.run_id, run_attempt: String(release.run_attempt), sha: release.sha },
    job: { steps: [{ name: 'Verify exact worker SHA before lock release', status: 'completed', conclusion: 'success' }] },
  };
  const env = { VERCEL_TOKEN: 'vercel-test', VERCEL_PROJECT_ID: 'prj_y6kGI7ZzyFWU6tyZbaklPtVsXeqx', VERCEL_ORG_ID: 'team_P85yMqd79TPq8aSGSt2kojWY', GH_TOKEN: 'gh-test' };
  let aliasReads = 0;
  const fetchImpl = async (url, options) => {
    assert.ok(options.headers.authorization.startsWith('Bearer '));
    if (String(url).includes('/v4/aliases/ogabassey.com')) {
      aliasReads += 1;
      return response({ deploymentId: 'dpl_abc123' });
    }
    if (String(url).includes('/v13/deployments/dpl_abc123')) {
      return response({ projectId: env.VERCEL_PROJECT_ID, readyState: 'READY', target: 'production', meta: { gitCommitSha: release.sha } });
    }
    if (String(url).includes('/git/ref/heads/main')) return response({ object: { sha: release.sha } });
    throw new Error(`unexpected API request ${url}`);
  };
  await verifyLiveAliasAndWorker(auth, env, fetchImpl, path);
  assert.equal(aliasReads, 2);
  assert.equal(readProductionReleaseLock(path), null);
});

test('ambiguous alias, changed main, wrong project, and missing worker proof retain the lock', async (t) => {
  const env = { VERCEL_TOKEN: 'vercel-test', VERCEL_PROJECT_ID: 'prj_y6kGI7ZzyFWU6tyZbaklPtVsXeqx', VERCEL_ORG_ID: 'team_P85yMqd79TPq8aSGSt2kojWY', GH_TOKEN: 'gh-test' };
  const auth = {
    claims: { run_id: release.run_id, run_attempt: String(release.run_attempt), sha: release.sha },
    job: { steps: [{ name: 'Verify exact worker SHA before lock release', status: 'completed', conclusion: 'success' }] },
  };
  for (const [label, fixtureOverrides, request] of [
    ['different main', {}, (url) => String(url).includes('/git/ref/heads/main') ? response({ object: { sha: 'b'.repeat(40) } }) : defaultVercel(url, env, release.sha)],
    ['wrong project', {}, (url) => defaultVercel(url, env, release.sha, { projectId: 'prj_wrong' })],
    ['unstable alias', {}, (() => { let reads = 0; return (url) => String(url).includes('/v4/aliases/') ? response({ deploymentId: `dpl_${++reads === 1 ? 'abc123' : 'different'}` }) : defaultVercel(url, env, release.sha); })()],
    ['worker verification absent', { missingWorker: true }, (url) => defaultVercel(url, env, release.sha)],
  ]) {
    const path = fixture(t);
    acquireProductionReleaseLock(path, release);
    const failedAuth = fixtureOverrides.missingWorker ? { ...auth, job: { steps: [] } } : auth;
    await assert.rejects(verifyLiveAliasAndWorker(failedAuth, env, request, path), /current main|does not match|changed during|worker SHA/,
      `expected ${label} to retain lock`);
    assert.equal(readProductionReleaseLock(path).sha, release.sha);
  }
});

function defaultVercel(url, env, sha, deploymentOverrides = {}) {
  const href = String(url);
  if (href.includes('/v4/aliases/')) return response({ deploymentId: 'dpl_abc123' });
  if (href.includes('/v13/deployments/')) return response({ projectId: env.VERCEL_PROJECT_ID, readyState: 'READY', target: 'production', meta: { gitCommitSha: sha }, ...deploymentOverrides });
  if (href.includes('/git/ref/heads/main')) return response({ object: { sha } });
  throw new Error(`unexpected API request ${href}`);
}

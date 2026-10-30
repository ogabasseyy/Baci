import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { authorizeCoordinatorJob, authorizeCoordinatorWorker, verifyGitHubActionsToken } from './authorize-coordinator-worker.mjs';

const sha = 'a'.repeat(40);
const audience = 'https://github.com/ogabasseyy/Baci';
const now = 1_798_000_000_000;
const claims = {
  iss: 'https://token.actions.githubusercontent.com', aud: audience,
  iat: Math.floor(now / 1000), nbf: Math.floor(now / 1000) - 1, exp: Math.floor(now / 1000) + 300,
  repository: 'ogabasseyy/Baci', repository_id: '21133777',
  workflow_ref: 'ogabasseyy/Baci/.github/workflows/production-release.yml@refs/heads/main',
  job_workflow_ref: 'ogabasseyy/Baci/.github/workflows/production-release.yml@refs/heads/main',
  ref: 'refs/heads/main', ref_type: 'branch', event_name: 'push', sha,
  run_id: '9182', run_attempt: '2', check_run_id: '7721', runner_environment: 'self-hosted',
};
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', use: 'sig', kty: 'RSA' };

function signedToken(overrides = {}, key = privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'key-1', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...claims, ...overrides })).toString('base64url');
  const input = `${header}.${body}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  signer.end();
  return `${input}.${signer.sign(key).toString('base64url')}`;
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test('verifies GitHub signature, fixed audience, repository, workflow, main SHA, and time bounds', () => {
  assert.equal(verifyGitHubActionsToken(signedToken(), { keys: [jwk] }, { audience, now }).run_id, '9182');
  assert.throws(() => verifyGitHubActionsToken(signedToken({ aud: 'wrong' }), { keys: [jwk] }, { audience, now }), /claims invalid/);
  assert.throws(() => verifyGitHubActionsToken(signedToken({ workflow_ref: 'attacker.yml' }), { keys: [jwk] }, { audience, now }), /claims invalid/);
  assert.throws(() => verifyGitHubActionsToken(signedToken({ run_attempt: '0' }), { keys: [jwk] }, { audience, now }), /claims invalid/);
  assert.throws(() => verifyGitHubActionsToken(signedToken(), { keys: [{ ...jwk, kid: 'other' }] }, { audience, now }), /key unavailable/);
  const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => verifyGitHubActionsToken(signedToken({}, otherKey), { keys: [jwk] }, { audience, now }), /signature verification failed/);
});

function apiFixture({ currentSha = sha, job = {}, run = {}, workflow = {}, failUrl = '', jobName = 'Sync VPS workers', jobWorkflowPath = '.github/workflows/production-release.yml' } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, options });
    if (href.startsWith('https://pipelines.actions.githubusercontent.com/token')) {
      return response({ value: signedToken({ job_workflow_ref: `ogabasseyy/Baci/${jobWorkflowPath}@refs/heads/main` }) });
    }
    if (href === 'https://token.actions.githubusercontent.com/.well-known/openid-configuration') {
      return response({ issuer: 'https://token.actions.githubusercontent.com', jwks_uri: 'https://token.actions.githubusercontent.com/.well-known/jwks' });
    }
    if (href === 'https://token.actions.githubusercontent.com/.well-known/jwks') return response({ keys: [jwk] });
    if (failUrl && href.includes(failUrl)) return response({}, 503);
    if (href === 'https://api.github.com/repos/ogabasseyy/Baci') return response({ id: 21133777, full_name: 'ogabasseyy/Baci' });
    if (href.endsWith('/actions/workflows/.github/workflows/production-release.yml')) {
      return response({ id: 90, path: '.github/workflows/production-release.yml', state: 'active', ...workflow });
    }
    if (href.endsWith('/actions/runs/9182')) {
      return response({ id: 9182, workflow_id: 90, path: '.github/workflows/production-release.yml@refs/heads/main', event: 'push', head_branch: 'main', head_sha: sha, status: 'in_progress', run_attempt: 2, name: 'Production release', ...run });
    }
    if (href.includes('/attempts/2/jobs')) {
      return response({ jobs: [{ id: 7721, run_id: 9182, name: jobName, status: 'in_progress', head_sha: sha, workflow_name: 'Production release', labels: ['baci-release'], runner_name: 'baci-release-01', ...job }] });
    }
    if (href.endsWith('/git/ref/heads/main')) return response({ object: { sha: currentSha } });
    throw new Error(`unexpected fetch ${href}`);
  };
  return { fetchImpl, calls };
}

test('authorizes only the active exact coordinator job on the trusted self-hosted runner and current main', async () => {
  const fixture = apiFixture();
  const result = await authorizeCoordinatorWorker({
    env: { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/token?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'short-lived', GH_TOKEN: 'actions-read' },
    fetchImpl: fixture.fetchImpl, now,
  });
  assert.equal(result.job.id, 7721);
  assert.ok(fixture.calls.some(({ href }) => href.endsWith('/actions/runs/9182/attempts/2/jobs?per_page=100')));
  assert.equal(fixture.calls.filter(({ options }) => options.headers?.authorization === 'Bearer short-lived').length, 1);
  assert.ok(fixture.calls.filter(({ href }) => href.includes('api.github.com')).every(({ options }) => options.headers?.authorization === 'Bearer actions-read'));
});

test('authorizes cache activation only for the exact reusable workflow job and path', async () => {
  const env = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'short-lived', GH_TOKEN: 'actions-read' };
  const fixture = apiFixture({ jobName: 'Manage cache worker capability', jobWorkflowPath: '.github/workflows/deploy.yml' });
  const auth = await authorizeCoordinatorJob({
    env,
    fetchImpl: fixture.fetchImpl,
    now,
    expectedJobName: 'Manage cache worker capability',
    expectedJobWorkflowPath: '.github/workflows/deploy.yml',
  });
  assert.equal(auth.claims.sha, sha);
  await assert.rejects(authorizeCoordinatorJob({
    env,
    fetchImpl: apiFixture({ jobName: 'Other job', jobWorkflowPath: '.github/workflows/deploy.yml' }).fetchImpl,
    now,
    expectedJobName: 'Manage cache worker capability',
    expectedJobWorkflowPath: '.github/workflows/deploy.yml',
  }), /not the active worker job/);
  await assert.rejects(authorizeCoordinatorJob({
    env,
    fetchImpl: apiFixture({ jobName: 'Manage cache worker capability' }).fetchImpl,
    now,
    expectedJobName: 'Manage cache worker capability',
    expectedJobWorkflowPath: '.github/workflows/deploy.yml',
  }), /claims invalid/);
});

test('rejects forged job ids, stale main, wrong runner, retry attempt, missing token, and API ambiguity', async () => {
  const env = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'short-lived', GH_TOKEN: 'actions-read' };
  await assert.rejects(authorizeCoordinatorWorker({ env: { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: 'https://attacker.invalid/token' }, fetchImpl: apiFixture().fetchImpl, now }), /unavailable/);
  await assert.rejects(authorizeCoordinatorWorker({ env, fetchImpl: apiFixture({ currentSha: 'b'.repeat(40) }).fetchImpl, now }), /no longer current main/);
  await assert.rejects(authorizeCoordinatorWorker({ env, fetchImpl: apiFixture({ job: { id: 7722 } }).fetchImpl, now }), /not the active worker job/);
  await assert.rejects(authorizeCoordinatorWorker({ env, fetchImpl: apiFixture({ job: { labels: ['baci-deploy'] } }).fetchImpl, now }), /not the active worker job/);
  await assert.rejects(authorizeCoordinatorWorker({ env, fetchImpl: apiFixture({ job: { labels: ['self-hosted', 'other'] } }).fetchImpl, now }), /not the active worker job/);
  await assert.rejects(authorizeCoordinatorWorker({ env, fetchImpl: apiFixture({ run: { run_attempt: 1 } }).fetchImpl, now }), /does not match/);
  await assert.rejects(authorizeCoordinatorWorker({ env, fetchImpl: apiFixture({ workflow: { state: 'disabled_manually' } }).fetchImpl, now }), /workflow is unavailable/);
  await assert.rejects(authorizeCoordinatorWorker({ env, fetchImpl: apiFixture({ workflow: { id: 91 } }).fetchImpl, now }), /does not match/);
  await assert.rejects(authorizeCoordinatorWorker({ env, fetchImpl: apiFixture({ failUrl: '/repos/ogabasseyy/Baci' }).fetchImpl, now }), /API request failed/);
  await assert.rejects(authorizeCoordinatorWorker({ env, fetchImpl: apiFixture({ failUrl: '/actions/runs/9182' }).fetchImpl, now }), /API request failed/);
});

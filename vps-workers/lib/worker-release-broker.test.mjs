import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  authorizeBrokerRequest,
  validateBundleManifest,
  verifyBrokerOidcToken,
  WORKER_RELEASE_BROKER_POLICY as policy,
} from './worker-release-broker.mjs';

const sha = 'a'.repeat(40);
const now = 1_798_000_000_000;
const archiveBytes = Buffer.from('verified github archive fixture');
const digest = createHash('sha256').update(archiveBytes).digest('hex');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
const audience = `https://github.com/${policy.repository}`;

test('archive allowance covers the measured repository while remaining bounded', () => {
  assert.ok(policy.maxBundleBytes >= 155_990_672);
  assert.equal(policy.maxBundleBytes, 256 * 1024 * 1024);
});

function token(claimChanges = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: 'https://token.actions.githubusercontent.com', aud: audience,
    exp: Math.floor(now / 1000) + 600, nbf: Math.floor(now / 1000) - 10,
    iat: Math.floor(now / 1000), repository: policy.repository,
    repository_id: 123456, workflow_ref: `${policy.repository}/${policy.workflow}@refs/heads/main`,
    job_workflow_ref: `${policy.repository}/${policy.workflow}@refs/heads/main`,
    ref: policy.branch, ref_type: 'branch', event_name: 'push', sha,
    run_id: '1234', run_attempt: 2, check_run_id: '5678', runner_environment: 'self-hosted',
    ...claimChanges,
  })).toString('base64url');
  const body = `${header}.${claims}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`;
}

function makeFetch({ runChanges = {}, jobChanges = {}, branchSha = sha } = {}) {
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, options });
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({
      issuer: 'https://token.actions.githubusercontent.com',
      jwks_uri: 'https://token.actions.githubusercontent.com/.well-known/jwks',
    });
    if (url.endsWith('/.well-known/jwks')) return Response.json({ keys: [jwk] });
    if (url === `https://api.github.com/repos/${policy.repository}`) return Response.json({ full_name: policy.repository, id: 123456 });
    if (url.endsWith(`/actions/workflows/${policy.workflow}`)) return Response.json({ path: policy.workflow, state: 'active', id: 987 });
    if (url.endsWith('/actions/runs/1234')) return Response.json({
      id: 1234, workflow_id: 987, path: policy.workflow, event: 'push', head_branch: 'main',
      head_sha: sha, status: 'in_progress', run_attempt: 2, ...runChanges,
    });
    if (url.endsWith('/attempts/2/jobs?per_page=100')) return Response.json({ jobs: [{
      id: 5678, run_id: 1234, name: 'Sync VPS workers', status: 'in_progress', head_sha: sha,
      labels: ['baci-release'], runner_name: 'baci-release-01', ...jobChanges,
    }] });
    if (url.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: branchSha } });
    if (url === `https://api.github.com/repos/${policy.repository}/tarball/${sha}`) return new Response(null, {
      status: 302, headers: { location: `https://codeload.github.com/ogabasseyy/Baci/legacy.tar.gz/${sha}` },
    });
    if (url === `https://codeload.github.com/ogabasseyy/Baci/legacy.tar.gz/${sha}`) return new Response(archiveBytes);
    throw new Error(`unexpected fixture request ${url}`);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const validRequest = { operation: 'stage', sourceSha: sha, bundleSha256: digest, oidcToken: token(), githubToken: 'job-token' };
const authorize = (overrides = {}) => authorizeBrokerRequest({
  peerUid: 2001, expectedReleaseUid: 2001, workerUid: 2002,
  request: validRequest, fetchImpl: makeFetch(), now, ...overrides,
});

test('cryptographically verifies the GitHub OIDC signature and coordinator claims', () => {
  assert.equal(verifyBrokerOidcToken(token(), { keys: [jwk] }, { now }).sha, sha);
  assert.throws(() => verifyBrokerOidcToken(token({ repository: 'attacker/repo' }), { keys: [jwk] }, { now }), /claims invalid/);
  assert.throws(() => verifyBrokerOidcToken(`${token().slice(0, -4)}xxxx`, { keys: [jwk] }, { now }), /signature verification failed/);
  assert.throws(() => verifyBrokerOidcToken(token({ exp: Math.floor(now / 1000) - 1 }), { keys: [jwk] }, { now }), /time claims invalid/);
});

test('authenticates live coordinator run and returns the source archive fetched by the broker', async () => {
  const result = await authorize();
  assert.equal(result.sourceSha, sha);
  assert.equal(result.operation, 'stage');
  assert.equal(result.runId, '1234');
  assert.equal(result.jobId, '5678');
  assert.equal(result.workerUid, 2002);
  assert.equal(result.workerRoot, '/srv/baci-workers');
  assert.deepEqual(result.sourceArchive, archiveBytes);
});

test('bounds the whole sequential authorization while allowing legitimate calls beyond the old 120 second dispatcher cap', async () => {
  const fetchImpl = makeFetch();
  let elapsedMs = 0;
  const result = await authorize({
    fetchImpl: async (...args) => {
      const response = await fetchImpl(...args);
      elapsedMs += 20_000;
      return response;
    },
    deadlineClock: () => elapsedMs,
  });
  assert.equal(result.sourceSha, sha);
  assert.equal(fetchImpl.calls.length, 9);
  assert.ok(elapsedMs > 120_000);
  assert.ok(elapsedMs < policy.authorizationDeadlineMs);

  const slowFetch = makeFetch();
  elapsedMs = 0;
  await assert.rejects(authorize({
    fetchImpl: async (...args) => {
      const response = await slowFetch(...args);
      elapsedMs += 40_000;
      return response;
    },
    deadlineClock: () => elapsedMs,
  }), /total deadline/);
  assert.equal(slowFetch.calls.length, 9);
});

test('preflight authenticates the live coordinator job without downloading source bytes', async () => {
  const fetchImpl = makeFetch();
  const result = await authorize({
    request: { operation: 'preflight', sourceSha: sha, oidcToken: token(), githubToken: 'job-token' },
    fetchImpl,
  });
  assert.equal(result.operation, 'preflight');
  assert.equal(result.sourceSha, sha);
  assert.equal(result.runId, '1234');
  assert.equal(result.runAttempt, 2);
  assert.equal(result.jobId, '5678');
  assert.equal('sourceArchive' in result, false);
  assert.equal(fetchImpl.calls.some(call => call.url.includes('/tarball/')), false);
});

test('readiness authenticates exact main and returns no privileged environment data', async () => {
  const result = await authorize({
    request: {
      operation: 'readiness', sourceSha: sha,
      oidcToken: token({ job_workflow_ref: `${policy.repository}/${policy.readinessWorkflow}@refs/heads/main` }),
      githubToken: 'job-token',
    },
    fetchImpl: makeFetch({ jobChanges: { name: policy.readinessJob } }),
  });
  assert.equal(result.operation, 'readiness');
  assert.equal(result.sourceSha, sha);
  assert.equal('sourceArchive' in result, false);
  assert.equal('githubToken' in result, false);
  await assert.rejects(authorize({
    request: {
      operation: 'promote', sourceSha: sha,
      oidcToken: token({ job_workflow_ref: `${policy.repository}/${policy.readinessWorkflow}@refs/heads/main` }),
      githubToken: 'job-token',
    },
    fetchImpl: makeFetch({ jobChanges: { name: policy.readinessJob } }),
  }), /job workflow does not match/);
});

test('the publishing job can request readiness but cannot promote workers', async () => {
  const oidcToken = token({ job_workflow_ref: `${policy.repository}/${policy.readinessWorkflow}@refs/heads/main` });
  const fetchImpl = makeFetch({ jobChanges: { name: 'Deploy to Vercel' } });
  const receipt = await authorize({ request: { operation: 'readiness', sourceSha: sha, oidcToken, githubToken: 'job-token' }, fetchImpl });
  assert.equal(receipt.operation, 'readiness');
  await assert.rejects(authorize({ request: { operation: 'promote', sourceSha: sha, oidcToken, githubToken: 'job-token' }, fetchImpl }), /job workflow does not match/);
});

test('GIGL capability smoke is restricted to the deploy workflow capability job', async () => {
  const result = await authorize({
    request: {
      operation: 'gigl-capability', sourceSha: sha,
      oidcToken: token({ job_workflow_ref: `${policy.repository}/${policy.readinessWorkflow}@refs/heads/main` }),
      githubToken: 'job-token',
    },
    fetchImpl: makeFetch({ jobChanges: { name: 'gigl-worker-capability' } }),
  });
  assert.equal(result.operation, 'gigl-capability');
  assert.equal(result.sourceSha, sha);
  assert.equal(result.workerRoot, '/srv/baci-workers');
  assert.equal('sourceArchive' in result, false);
  assert.equal('githubToken' in result, false);
  await assert.rejects(authorize({
    request: {
      operation: 'gigl-capability', sourceSha: sha,
      oidcToken: token(), githubToken: 'job-token',
    },
    fetchImpl: makeFetch({ jobChanges: { name: 'Sync VPS workers' } }),
  }), /job workflow does not match/);
  await assert.rejects(authorize({
    request: {
      operation: 'gigl-capability', sourceSha: sha,
      oidcToken: token({ job_workflow_ref: `${policy.repository}/${policy.readinessWorkflow}@refs/heads/main` }),
      githubToken: 'job-token',
    },
    fetchImpl: makeFetch({ jobChanges: { name: 'Deploy to Vercel' } }),
  }), /active worker job/);
});

test('refuses any peer other than the configured release UID and invalid account config', async () => {
  await assert.rejects(authorize({ peerUid: 0 }), /unauthorized peer/);
  await assert.rejects(authorize({ peerUid: 2002 }), /unauthorized peer/);
  await assert.rejects(authorize({ expectedReleaseUid: 2001, workerUid: 2001 }), /account configuration is invalid/);
});

test('refuses live API mismatches, stale main, or a caller digest not matching GitHub bytes', async () => {
  await assert.rejects(authorize({ fetchImpl: makeFetch({ runChanges: { status: 'completed' } }) }), /run does not match/);
  await assert.rejects(authorize({ fetchImpl: makeFetch({ jobChanges: { name: 'Deploy to Vercel' } }) }), /active worker job/);
  await assert.rejects(authorize({ fetchImpl: makeFetch({ jobChanges: { labels: ['self-hosted', 'baci-deploy'] } }) }), /active worker job/);
  await assert.rejects(authorize({ fetchImpl: makeFetch({ branchSha: 'c'.repeat(40) }) }), /no longer current main/);
  await assert.rejects(authorize({ request: { ...validRequest, bundleSha256: 'c'.repeat(64) } }), /does not match GitHub source/);
});

test('rejects unknown operations, malformed source SHA, and extra caller-controlled fields', async () => {
  await assert.rejects(authorize({ request: { ...validRequest, operation: 'shell' } }), /unknown operation/);
  await assert.rejects(authorize({ request: { ...validRequest, sourceSha: '../main' } }), /SHA is invalid/);
  await assert.rejects(authorize({ request: { ...validRequest, command: 'systemctl stop anything' } }), /unsupported fields/);
  await assert.rejects(authorize({ request: { ...validRequest, path: '/etc/passwd' } }), /unsupported fields/);
});

test('only the fixed operation set is exposed', () => {
  assert.deepEqual(policy.operations, ['stage', 'preflight', 'readiness', 'gigl-capability', 'promote', 'health', 'rollback']);
  assert.equal(policy.operations.includes('systemctl'), false);
  assert.equal(policy.operations.includes('exec'), false);
});

test('accepts normalized regular files and directories within the bundle limit', () => {
  assert.equal(validateBundleManifest([
    { type: 'directory', path: 'jobs' }, { type: 'file', path: 'jobs/worker.mjs', size: 12 },
  ], 12), true);
});

test('rejects archive traversal, links, special files, duplicate paths, and oversized bundles', () => {
  const cases = [
    [{ type: 'file', path: '../escape', size: 1 }],
    [{ type: 'file', path: '/absolute', size: 1 }],
    [{ type: 'symlink', path: 'link', size: 0 }],
    [{ type: 'hardlink', path: 'link', size: 0 }],
    [{ type: 'device', path: 'device', size: 1 }],
    [{ type: 'file', path: 'a', size: 1 }, { type: 'file', path: 'a', size: 1 }],
  ];
  for (const entries of cases) assert.throws(() => validateBundleManifest(entries, 2));
  assert.throws(() => validateBundleManifest([{ type: 'file', path: 'large', size: 1 }], policy.maxBundleBytes + 1), /size limit/);
  assert.throws(() => validateBundleManifest([], 0), /empty/);
});

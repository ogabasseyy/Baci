import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign as signBytes,
} from 'node:crypto';
import test from 'node:test';
import {
  HOSTED_LOCK_PROOF_POLICY as policy,
  createHostedReleaseActionAuthorizer,
  createHostedReleaseLockProofIssuer,
  readHostReleaseLock,
  verifyHostedReleaseLockLease,
} from './worker-release-hosted-lock-proof.mjs';

const sha = 'a'.repeat(40);
const identity = { runId: '123456789', runAttempt: 2, jobId: '987654321', sha, event: 'push' };
const oidcKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const leaseKeys = generateKeyPairSync('ed25519');
const oidcJwk = oidcKeys.publicKey.export({ format: 'jwk' });
const jwks = { keys: [{ ...oidcJwk, kid: 'test-github-kid', use: 'sig', alg: 'RS256' }] };

function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }

function makeOidc(overrides = {}, headerExtra = {}) {
  const now = 1_800_000_000;
  const header = encode({ alg: 'RS256', kid: 'test-github-kid', typ: 'JWT', ...headerExtra });
  const claims = encode({
    iss: 'https://token.actions.githubusercontent.com',
    aud: `https://github.com/${policy.repository}`,
    iat: now - 5,
    nbf: now - 5,
    exp: now + 295,
    repository: policy.repository,
    repository_id: policy.repositoryId,
    workflow_ref: `${policy.repository}/${policy.coordinatorWorkflow}@${policy.ref}`,
    job_workflow_ref: `${policy.repository}/${policy.reusableWorkflow}@${policy.ref}`,
    ref: policy.ref,
    ref_type: 'branch',
    environment: policy.environment,
    sub: `repo:${policy.repository}:environment:${policy.environment}`,
    runner_environment: 'github-hosted',
    event_name: identity.event,
    sha: identity.sha,
    run_id: identity.runId,
    run_attempt: String(identity.runAttempt),
    check_run_id: identity.jobId,
    ...overrides,
  });
  const input = `${header}.${claims}`;
  return `${input}.${signBytes('RSA-SHA256', Buffer.from(input), oidcKeys.privateKey).toString('base64url')}`;
}

function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

function mockFetch({ run = {}, job = {}, workflow = {}, ref = {}, jwksValue = jwks, onRequest } = {}) {
  return async (url, options = {}) => {
    const path = new URL(url).pathname;
    onRequest?.(path, options);
    if (url === 'https://token.actions.githubusercontent.com/.well-known/openid-configuration') {
      return response({ issuer: 'https://token.actions.githubusercontent.com', jwks_uri: 'https://token.actions.githubusercontent.com/.well-known/jwks' });
    }
    if (url === 'https://token.actions.githubusercontent.com/.well-known/jwks') return response(jwksValue);
    if (path.endsWith(`/actions/workflows/${policy.coordinatorWorkflow}`)) return response({ path: policy.coordinatorWorkflow, state: 'active', id: 42, ...workflow });
    if (path.endsWith(`/actions/runs/${identity.runId}`)) return response({
      id: Number(identity.runId), workflow_id: 42, path: policy.coordinatorWorkflow,
      event: identity.event, head_branch: 'main', head_sha: identity.sha,
      status: 'in_progress', run_attempt: identity.runAttempt, ...run,
    });
    if (path.endsWith(`/attempts/${identity.runAttempt}/jobs`)) return response({ jobs: [{
      id: Number(identity.jobId), run_id: Number(identity.runId), name: policy.jobName,
      status: 'in_progress', head_sha: identity.sha, labels: [policy.expectedRunner], ...job,
    }] });
    if (path.endsWith('/git/ref/heads/main')) return response({ object: { sha: identity.sha }, ...ref });
    throw new Error(`unexpected test request ${path}`);
  };
}

async function issue(overrides = {}) {
  const issuer = createHostedReleaseLockProofIssuer({
    expectedReleaseUid: 501, signingPrivateKey: leaseKeys.privateKey,
    fetchImpl: mockFetch(overrides.api), nowSeconds: () => 1_800_000_000,
    readLock: overrides.readLock ?? (() => ({ ...identity, state: 'worker_syncing', device: '2049', inode: '8123' })),
  });
  return issuer({ oidcToken: makeOidc(overrides.claims, overrides.header), githubToken: 'test-gh-token' });
}

test('issues a short-lived lease only from authenticated active hosted job and matching host lock', async () => {
  const token = await issue();
  assert.deepEqual(verifyHostedReleaseLockLease({ token, publicKey: leaseKeys.publicKey, nowSeconds: 1_800_000_010 }), {
    runId: identity.runId, runAttempt: identity.runAttempt, jobId: identity.jobId,
    sha: identity.sha, lockState: 'worker_syncing', lockDevice: '2049', lockInode: '8123',
  });
});

test('rejects modified or incorrectly scoped GitHub OIDC claims', async () => {
  await assert.rejects(issue({ claims: { repository_id: '999' } }), /proof denied/);
  await assert.rejects(issue({ claims: { job_workflow_ref: 'attacker/repo/.github/workflows/deploy.yml@refs/heads/main' } }), /proof denied/);
  const valid = makeOidc();
  const pieces = valid.split('.');
  pieces[2] = Buffer.from('forged').toString('base64url');
  const issuer = createHostedReleaseLockProofIssuer({
    expectedReleaseUid: 501, signingPrivateKey: leaseKeys.privateKey,
    fetchImpl: mockFetch(), nowSeconds: () => 1_800_000_000,
    readLock: () => ({ ...identity, state: 'worker_syncing', device: '2049', inode: '8123' }),
  });
  await assert.rejects(issuer({ oidcToken: pieces.join('.'), githubToken: 'test-gh-token' }), /proof denied/);
});

test('accepts x5t only when it is canonical and matches the pinned JWKS certificate thumbprint', async () => {
  const x5t = Buffer.alloc(20, 7).toString('base64url');
  const issuer = createHostedReleaseLockProofIssuer({
    expectedReleaseUid: 501, signingPrivateKey: leaseKeys.privateKey,
    fetchImpl: mockFetch({ jwksValue: { keys: [{ ...jwks.keys[0], x5t }] } }),
    nowSeconds: () => 1_800_000_000,
    readLock: () => ({ ...identity, state: 'worker_syncing', device: '2049', inode: '8123' }),
  });
  const lease = await issuer({ oidcToken: makeOidc({}, { x5t }), githubToken: 'test-gh-token' });
  assert.equal(verifyHostedReleaseLockLease({ token: lease, publicKey: leaseKeys.publicKey, nowSeconds: 1_800_000_010 }).sha, sha);

  const mismatchIssuer = createHostedReleaseLockProofIssuer({
    expectedReleaseUid: 501, signingPrivateKey: leaseKeys.privateKey,
    fetchImpl: mockFetch({ jwksValue: { keys: [{ ...jwks.keys[0], x5t: Buffer.alloc(20, 8).toString('base64url') }] } }),
    nowSeconds: () => 1_800_000_000,
    readLock: () => ({ ...identity, state: 'worker_syncing', device: '2049', inode: '8123' }),
  });
  await assert.rejects(mismatchIssuer({ oidcToken: makeOidc({}, { x5t }), githubToken: 'test-gh-token' }), /proof denied/);
  await assert.rejects(issue({ header: { x5t: 'not-a-canonical-thumbprint' } }), /proof denied/);
});

test('requires live GitHub run, exact active hosted job, and current main SHA', async () => {
  await assert.rejects(issue({ api: { run: { status: 'completed' } } }), /proof denied/);
  await assert.rejects(issue({ api: { job: { labels: ['self-hosted', 'baci-release'] } } }), /proof denied/);
  await assert.rejects(issue({ api: { ref: { object: { sha: 'b'.repeat(40) } } } }), /proof denied/);
  await assert.rejects(issue({ api: { workflow: { state: 'disabled' } } }), /proof denied/);
});

test('requires the fixed host lock to match exact run, attempt, and SHA', async () => {
  await assert.rejects(issue({ readLock: () => null }), /does not match/);
  await assert.rejects(issue({ readLock: () => ({ ...identity, runAttempt: 1, state: 'worker_syncing' }) }), /does not match/);
  await assert.rejects(issue({ readLock: () => ({ ...identity, sha: 'c'.repeat(40), state: 'worker_syncing' }) }), /does not match/);
  await assert.rejects(issue({ readLock: () => ({ ...identity, state: 'unlocked' }) }), /does not match/);
  assert.throws(() => readHostReleaseLock({ expectedUid: process.getuid(), path: '/tmp/caller-selected-lock' }), /pinned path/);
  assert.throws(() => readHostReleaseLock({ expectedUid: undefined }), /owner configuration/);
});

test('signed lease is bound, short-lived, and rejects tampering or replay outside its time window', async () => {
  const token = await issue();
  assert.throws(() => verifyHostedReleaseLockLease({ token, publicKey: leaseKeys.publicKey, nowSeconds: 1_800_000_061 }), /proof denied/);
  const [header, body] = token.split('.');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  claims.aud = 'untrusted-caller-selected-audience';
  const input = `${header}.${encode(claims)}`;
  const wrongAudience = `${input}.${signBytes(null, Buffer.from(input, 'ascii'), leaseKeys.privateKey).toString('base64url')}`;
  assert.throws(() => verifyHostedReleaseLockLease({ token: wrongAudience, publicKey: leaseKeys.publicKey, nowSeconds: 1_800_000_010 }), /proof denied/);
  const pieces = token.split('.');
  pieces[1] = encode({ aud: 'attacker', exp: 1_800_000_060, iat: 1_800_000_000 });
  assert.throws(() => verifyHostedReleaseLockLease({ token: pieces.join('.'), publicKey: leaseKeys.publicKey, nowSeconds: 1_800_000_010 }), /proof denied/);
});

test('action authorization rechecks live run and exact host lock instead of trusting the old lease alone', async () => {
  const lease = await issue();
  const auth = overrides => createHostedReleaseActionAuthorizer({
    expectedReleaseUid: 501, leasePublicKey: leaseKeys.publicKey,
    fetchImpl: mockFetch(overrides?.api), nowSeconds: () => 1_800_000_010,
    readLock: overrides?.readLock ?? (() => ({ ...identity, state: 'worker_syncing', device: '2049', inode: '8123' })),
  });
  const authorize = auth();
  const proof = await authorize({ lease, oidcToken: makeOidc(), githubToken: 'test-gh-token' });
  assert.equal(proof.sha, sha);

  await assert.rejects(auth({ readLock: () => ({ ...identity, state: 'worker_syncing', device: '2049', inode: '9999' }) })
    ({ lease, oidcToken: makeOidc(), githubToken: 'test-gh-token' }), /fresh host lock evidence/);
  await assert.rejects(auth({ api: { run: { status: 'completed' } } })
    ({ lease, oidcToken: makeOidc(), githubToken: 'test-gh-token' }), /proof denied/);
});

test('host lock file reader refuses caller-selected paths and unset owner identity', () => {
  assert.throws(() => readHostReleaseLock({ expectedUid: process.getuid(), path: '/tmp/attacker-lock' }), /pinned path/);
  assert.throws(() => readHostReleaseLock({ expectedUid: 0 }), /owner configuration/);
});

import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { authorizeBrokerRequest, WORKER_RELEASE_BROKER_POLICY as policy } from './worker-release-broker.mjs';

const sha = 'a'.repeat(40);
const now = 1_798_000_000_000;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'current-owner', use: 'sig', alg: 'RS256' };
const audience = `https://github.com/${policy.repository}`;

function signedCurrentOwnerToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: 'https://token.actions.githubusercontent.com', aud: audience,
    exp: Math.floor(now / 1000) + 600, nbf: Math.floor(now / 1000) - 10,
    iat: Math.floor(now / 1000), repository: policy.repository, repository_id: 123456,
    workflow_ref: `${policy.repository}/${policy.workflow}@refs/heads/main`,
    job_workflow_ref: `${policy.repository}/${policy.workflow}@refs/heads/main`,
    ref: policy.branch, ref_type: 'branch', event_name: 'push', sha,
    run_id: '1234', run_attempt: 2, check_run_id: '5678', runner_environment: 'self-hosted',
  })).toString('base64url');
  const content = `${header}.${claims}`;
  return `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
}

test('omitted target is accepted only as current-job recovery input, with active GitHub job proof', async () => {
  const calls = [];
  const fetchImpl = async input => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({
      issuer: 'https://token.actions.githubusercontent.com',
      jwks_uri: 'https://token.actions.githubusercontent.com/.well-known/jwks',
    });
    if (url.endsWith('/.well-known/jwks')) return Response.json({ keys: [jwk] });
    if (url === `https://api.github.com/repos/${policy.repository}`) return Response.json({
      full_name: policy.repository, id: 123456,
    });
    if (url.endsWith(`/actions/workflows/${policy.workflow}`)) return Response.json({
      path: policy.workflow, state: 'active', id: 987,
    });
    if (url.endsWith('/actions/runs/1234')) return Response.json({
      id: 1234, workflow_id: 987, path: policy.workflow, event: 'push',
      head_branch: 'main', head_sha: sha, status: 'in_progress', run_attempt: 2,
    });
    if (url.endsWith('/attempts/2/jobs?per_page=100')) return Response.json({ jobs: [{
      id: 5678, run_id: 1234, name: 'Sync VPS workers', status: 'in_progress', head_sha: sha,
      labels: [policy.runnerLabel], runner_name: 'baci-release-current',
    }] });
    if (url.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha } });
    throw new Error('unexpected API request');
  };

  const receipt = await authorizeBrokerRequest({
    peerUid: 2001, expectedReleaseUid: 2001, workerUid: 2002, now, fetchImpl,
    request: { operation: 'recover', sourceSha: sha, oidcToken: signedCurrentOwnerToken(), githubToken: 'test-token' },
  });
  assert.equal(receipt.operation, 'recover');
  assert.equal(receipt.runId, '1234');
  assert.equal(receipt.runAttempt, 2);
  assert.equal(receipt.jobId, '5678');
  assert.equal('recoveryOf' in receipt, false);
  assert.equal(calls.some(url => url.includes('/actions/runs/1234/attempts/2/jobs')), true);
  assert.equal(calls.some(url => url.includes('/actions/runs/1111')), false);
});

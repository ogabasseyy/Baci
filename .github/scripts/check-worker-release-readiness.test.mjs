import assert from 'node:assert/strict';
import test from 'node:test';
import { checkWorkerReleaseReadiness } from './check-worker-release-readiness.mjs';

const sha = 'a'.repeat(40);

test('requests broker-owned readiness and exports only exact-SHA safe signals', async () => {
  let brokerRequest;
  let output;
  await checkWorkerReleaseReadiness({
    env: {
      BACI_EXPECTED_APP_SHA: sha, GITHUB_OUTPUT: '/tmp/github-output',
      GITHUB_TOKEN: 'github-token', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid/request',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-request-token',
    },
    broker: async (request) => {
      brokerRequest = request;
      return { ready: true, sourceSha: sha, installedSha: sha };
    },
    write: (_path, contents, options) => { output = { contents, options }; },
  });
  assert.deepEqual(brokerRequest, {
    operation: 'readiness', sha, githubToken: 'github-token',
    oidcRequestUrl: 'https://oidc.invalid/request', oidcRequestToken: 'oidc-request-token',
  });
  assert.match(output.contents, /worker_units_ready=true/);
  assert.match(output.contents, /installed_sha=a{40}/);
  assert.doesNotMatch(output.contents, /cutover_latched|tracking_stale|manifest_drift/);
  assert.deepEqual(output.options, { mode: 0o600 });
  assert.doesNotMatch(output.contents, /github-token|oidc-request-token/);
});

test('refuses mismatched broker SHA and never reports readiness', async () => {
  let wrote = false;
  await assert.rejects(checkWorkerReleaseReadiness({
    env: { GITHUB_SHA: sha, GITHUB_OUTPUT: '/tmp/github-output' },
    broker: async () => ({ ready: true, sourceSha: sha, installedSha: 'b'.repeat(40) }),
    write: () => { wrote = true; },
  }), /does not match the exact release SHA/);
  assert.equal(wrote, false);
  await assert.rejects(checkWorkerReleaseReadiness({ env: {}, broker: async () => assert.fail('broker must not be called') }), /expected SHA is invalid/);
});

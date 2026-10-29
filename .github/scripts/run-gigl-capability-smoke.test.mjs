import assert from 'node:assert/strict';
import test from 'node:test';
import { runGiglCapabilitySmoke } from './run-gigl-capability-smoke.mjs';

const sha = 'a'.repeat(40);

test('requests the broker-owned capability smoke and reports only safe metadata', async () => {
  let request;
  const output = await runGiglCapabilitySmoke({
    env: {
      BACI_EXPECTED_APP_SHA: sha, GH_TOKEN: 'github-token',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid/request',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-request-token',
    },
    broker: async (value) => {
      request = value;
      return {
        operation: 'gigl-capability', sourceSha: sha, smokePassed: true, latched: true,
        scope: 'enabled', installedSha: sha, latchedSha: sha,
      };
    },
  });
  assert.deepEqual(request, {
    operation: 'gigl-capability', sha, githubToken: 'github-token',
    oidcRequestUrl: 'https://oidc.invalid/request', oidcRequestToken: 'oidc-request-token',
  });
  assert.equal(output, `GIGL capability smoke and latch passed for installed worker ${sha} (enabled).\n`);
  assert.doesNotMatch(output, /github-token|oidc-request-token/);
});

test('rejects an invalid SHA or mismatched and unsafe broker receipts', async () => {
  await assert.rejects(runGiglCapabilitySmoke({
    env: { GITHUB_SHA: 'invalid' },
    broker: async () => assert.fail('broker must not be called'),
  }), /expected SHA is invalid/);
  for (const receipt of [
    { operation: 'gigl-capability', sourceSha: 'c'.repeat(40), smokePassed: true, latched: true, scope: 'enabled', installedSha: sha, latchedSha: sha },
    { operation: 'gigl-capability', sourceSha: sha, smokePassed: false, latched: true, scope: 'enabled', installedSha: sha, latchedSha: sha },
    { operation: 'gigl-capability', sourceSha: sha, smokePassed: true, latched: true, scope: 'invalid', installedSha: sha, latchedSha: sha },
    { operation: 'gigl-capability', sourceSha: sha, smokePassed: true, latched: true, scope: 'enabled', installedSha: 'b'.repeat(40), latchedSha: 'b'.repeat(40) },
  ]) {
    await assert.rejects(runGiglCapabilitySmoke({
      env: { BACI_EXPECTED_APP_SHA: sha }, broker: async () => receipt,
    }), /receipt is invalid/);
  }
});

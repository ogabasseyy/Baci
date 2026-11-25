import assert from 'node:assert/strict';
import test from 'node:test';
import { smokeCheckManifestEndpoint } from './smoke-check-ota-manifest.mjs';

function multipartResponse(jsonBody) {
  const boundary = 'ota-smoke-boundary';
  const payload = [
    `--${boundary}`,
    'content-type: application/json; charset=utf-8',
    'content-disposition: form-data; name="manifest"',
    '',
    JSON.stringify(jsonBody),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
  });
}

test('smoke check verifies active manifest updateId and rollBackToEmbedded directive', async () => {
  const updateId = '11111111-1111-4111-8111-111111111111';
  const manifestResult = await smokeCheckManifestEndpoint(
    {
      manifestUrl: 'https://ota.usebaci.com/api/manifest',
      platform: 'ios',
      runtimeVersion: '2.1.663-ios-sdk58-rn0880-splashmotion1',
      channel: 'production',
      expectedMode: 'update',
      expectedUpdateId: updateId,
    },
    async () => multipartResponse({ id: updateId })
  );
  assert.equal(manifestResult.id, updateId);

  const rollbackResult = await smokeCheckManifestEndpoint(
    {
      manifestUrl: 'https://ota.usebaci.com/api/manifest',
      platform: 'ios',
      runtimeVersion: '2.1.663-ios-sdk58-rn0880-splashmotion1',
      channel: 'production',
      expectedMode: 'rollback_to_embedded',
    },
    async (_url, init) => {
      const headers = new Headers(init?.headers);
      assert.ok(headers.get('expo-current-update-id'));
      assert.ok(headers.get('expo-embedded-update-id'));
      return multipartResponse({ type: 'rollBackToEmbedded' });
    }
  );
  assert.equal(rollbackResult.type, 'rollBackToEmbedded');
});

test('smoke check fails on HTTP 500 or unexpected update id', async () => {
  await assert.rejects(
    smokeCheckManifestEndpoint(
      {
        manifestUrl: 'https://ota.usebaci.com/api/manifest',
        platform: 'ios',
        runtimeVersion: '2.1.663',
        channel: 'production',
        expectedMode: 'update',
        expectedUpdateId: '11111111-1111-4111-8111-111111111111',
      },
      async () => new Response('Signing error', { status: 500 })
    ),
    /500/
  );

  await assert.rejects(
    smokeCheckManifestEndpoint(
      {
        manifestUrl: 'https://ota.usebaci.com/api/manifest',
        platform: 'ios',
        runtimeVersion: '2.1.663',
        channel: 'production',
        expectedMode: 'update',
        expectedUpdateId: '11111111-1111-4111-8111-111111111111',
      },
      async () => multipartResponse({ id: '22222222-2222-4222-8222-222222222222' })
    ),
    /Expected active manifest id/
  );
});

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { smokeCheckManifestEndpoint } from './smoke-check-ota-manifest.mjs';

function multipartResponse(jsonBody, extraHeaders = []) {
  const boundary = 'ota-smoke-boundary';
  const body = JSON.stringify(jsonBody);
  const payload = [
    `--${boundary}`,
    'content-type: application/json; charset=utf-8',
    'content-disposition: form-data; name="manifest"',
    ...extraHeaders,
    '',
    body,
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

test('smoke check verifies expo-signature keyid and cryptographic signature when requested', async () => {
  const updateId = '11111111-1111-4111-8111-111111111111';
  const payload = { id: updateId };
  const serialized = JSON.stringify(payload);
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const signer = createSign('RSA-SHA256');
  signer.update(serialized, 'utf8');
  const sig = signer.sign(privateKey).toString('base64');

  const ok = await smokeCheckManifestEndpoint(
    {
      manifestUrl: 'https://ota.usebaci.com/api/manifest',
      platform: 'ios',
      runtimeVersion: '2.1.663',
      channel: 'production',
      expectedMode: 'update',
      expectedUpdateId: updateId,
      expectSignatureKeyId: 'baci-prod-1',
      publicKeyOrCertPem: publicKey,
    },
    async () =>
      multipartResponse(payload, [
        `expo-signature: sig="${sig}", keyid="baci-prod-1", alg="rsa-v1_5-sha256"`,
      ])
  );
  assert.equal(ok.id, updateId);

  await assert.rejects(
    smokeCheckManifestEndpoint(
      {
        manifestUrl: 'https://ota.usebaci.com/api/manifest',
        platform: 'ios',
        runtimeVersion: '2.1.663',
        channel: 'production',
        expectedMode: 'update',
        expectedUpdateId: updateId,
        expectSignatureKeyId: 'baci-prod-1',
      },
      async () => multipartResponse(payload)
    ),
    /Expected expo-signature header/
  );

  await assert.rejects(
    smokeCheckManifestEndpoint(
      {
        manifestUrl: 'https://ota.usebaci.com/api/manifest',
        platform: 'ios',
        runtimeVersion: '2.1.663',
        channel: 'production',
        expectedMode: 'update',
        expectedUpdateId: updateId,
        expectSignatureKeyId: 'baci-prod-1',
      },
      async () =>
        multipartResponse(payload, [
          `expo-signature: sig="${sig}", keyid="wrong-key", alg="rsa-v1_5-sha256"`,
        ])
    ),
    /Expected expo-signature keyid "baci-prod-1"/
  );
});

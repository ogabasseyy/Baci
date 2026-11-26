import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { smokeCheckManifestEndpoint } from './smoke-check-ota-manifest.mjs';

const BUNDLE_BYTES = Buffer.from('console.log("smoke-bundle");');
const BUNDLE_HASH = createHash('sha256').update(BUNDLE_BYTES).digest('base64url');
const LAUNCH_URL = 'https://ota.usebaci.com/api/assets/bundles/ios/b.hbc';
const ASSET_URL = 'https://ota.usebaci.com/api/assets/blobs/logo.png';

function buildManifestPayload(id) {
  return {
    id,
    launchAsset: {
      url: LAUNCH_URL,
      contentType: 'application/javascript',
      hash: BUNDLE_HASH,
    },
    assets: [
      {
        url: ASSET_URL,
        contentType: 'image/png',
        hash: BUNDLE_HASH,
      },
    ],
  };
}

function multipartResponse(jsonBody, extraHeaders = [], dispositionName = 'manifest') {
  const boundary = 'ota-smoke-boundary';
  const body = JSON.stringify(jsonBody);
  const payload = [
    `--${boundary}`,
    'content-type: application/json; charset=utf-8',
    ...(dispositionName !== null
      ? [`content-disposition: form-data; name="${dispositionName}"`]
      : []),
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

function assetAwareFetch(manifestFactory, overrides = {}) {
  return async (url, init) => {
    const u = String(url);
    if (u === LAUNCH_URL) {
      if (overrides.launch) return overrides.launch(u, init);
      return new Response(BUNDLE_BYTES, {
        status: 200,
        headers: { 'content-type': 'application/javascript' },
      });
    }
    if (u === ASSET_URL) {
      if (overrides.asset) return overrides.asset(u, init);
      return new Response(BUNDLE_BYTES, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    return manifestFactory(u, init);
  };
}

test('smoke check verifies active manifest, asset downloads, and rollBackToEmbedded directive', async () => {
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
    assetAwareFetch(() => multipartResponse(buildManifestPayload(updateId)))
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
      return multipartResponse({ type: 'rollBackToEmbedded' }, [], 'directive');
    }
  );
  assert.equal(rollbackResult.type, 'rollBackToEmbedded');
});

test('smoke check fails on HTTP 500, unexpected update id, missing asset, or hash mismatch', async () => {
  const updateId = '11111111-1111-4111-8111-111111111111';
  await assert.rejects(
    smokeCheckManifestEndpoint(
      {
        manifestUrl: 'https://ota.usebaci.com/api/manifest',
        platform: 'ios',
        runtimeVersion: '2.1.663',
        channel: 'production',
        expectedMode: 'update',
        expectedUpdateId: updateId,
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
        expectedUpdateId: updateId,
      },
      async () => multipartResponse(buildManifestPayload('22222222-2222-4222-8222-222222222222'))
    ),
    /Expected active manifest id/
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
      },
      assetAwareFetch(() => multipartResponse(buildManifestPayload(updateId)), {
        launch: () => new Response('Not found', { status: 404 }),
      })
    ),
    /Launch asset smoke fetch failed \(404\)/
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
      },
      assetAwareFetch(() => multipartResponse(buildManifestPayload(updateId)), {
        launch: () =>
          new Response('tampered-bytes', {
            status: 200,
            headers: { 'content-type': 'application/javascript' },
          }),
      })
    ),
    /Launch asset SHA-256 mismatch/
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
      },
      assetAwareFetch(() => multipartResponse(buildManifestPayload(updateId)), {
        asset: () => new Response('Not found', { status: 404 }),
      })
    ),
    /Asset smoke fetch failed \(404\)/
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
      },
      assetAwareFetch(() => multipartResponse(buildManifestPayload(updateId)), {
        asset: () =>
          new Response('corrupted-asset-bytes', {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
      })
    ),
    /Asset SHA-256 mismatch/
  );
});

test('smoke check verifies expo-signature keyid, multipart disposition, and cryptographic signature', async () => {
  const updateId = '11111111-1111-4111-8111-111111111111';
  const payload = buildManifestPayload(updateId);
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
    assetAwareFetch(() =>
      multipartResponse(payload, [
        `expo-signature: sig="${sig}", keyid="baci-prod-1", alg="rsa-v1_5-sha256"`,
      ])
    )
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
    /OTA_CODE_SIGNING_CERTIFICATE_PATH is missing/
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
        publicKeyOrCertPem: publicKey,
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
        publicKeyOrCertPem: publicKey,
      },
      async () =>
        multipartResponse(payload, [
          `expo-signature: sig="${sig}", keyid="wrong-key", alg="rsa-v1_5-sha256"`,
        ])
    ),
    /Expected expo-signature keyid "baci-prod-1"/
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
        publicKeyOrCertPem: publicKey,
      },
      async () =>
        multipartResponse(
          { ...payload, tampered: true },
          [
            `expo-signature: sig="${sig}", keyid="baci-prod-1", alg="rsa-v1_5-sha256"`,
          ]
        )
    ),
    /Cryptographic verification failed/
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
      },
      async () => {
        const boundary = 'ota-smoke-boundary';
        const body = [
          `--${boundary}`,
          'content-type: application/json; charset=utf-8',
          'content-disposition: form-data; name="manifest"',
          '',
          JSON.stringify(payload),
          `--${boundary}`,
          'content-type: application/json; charset=utf-8',
          'content-disposition: form-data; name="extra"',
          '',
          JSON.stringify({ rogue: true }),
          `--${boundary}--`,
          '',
        ].join('\r\n');
        return new Response(body, {
          status: 200,
          headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
        });
      }
    ),
    /Expected exactly 1 manifest\/directive multipart part/
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
      },
      async () => multipartResponse(payload, [], 'directive')
    ),
    /Expected multipart content-disposition name="manifest"/
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
      },
      async () => multipartResponse(payload, [], null)
    ),
    /Expected multipart content-disposition name="manifest"/
  );
});

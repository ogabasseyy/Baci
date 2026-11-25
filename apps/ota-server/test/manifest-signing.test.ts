import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { OtaWorkerEnv, StoredReleaseRecord } from '../src/types';
import { MockR2Bucket } from './helpers/mock-r2';
import { parseMultipartMixed } from './helpers/multipart-parser';

const UPDATE_ID = '11111111-1111-4111-8111-111111111111';
const RUNTIME = '2.1.663-ios-sdk58-rn0880-splashmotion1';

function createBaseHeaders(overrides: Record<string, string> = {}) {
  return {
    'expo-protocol-version': '1',
    'expo-platform': 'ios',
    'expo-runtime-version': RUNTIME,
    'expo-channel-name': 'production',
    ...overrides,
  };
}

async function seedRelease(bucket: MockR2Bucket) {
  const release: StoredReleaseRecord = {
    id: UPDATE_ID,
    createdAt: '2026-11-25T15:00:00.000Z',
    runtimeVersion: RUNTIME,
    channel: 'production',
    platform: 'ios',
    launchAsset: {
      hash: 'bundle-sha256-base64url',
      key: 'bundle-key',
      contentType: 'application/javascript',
      fileExtension: '.hbc',
      r2Key: 'bundles/ios/abc123.hbc',
    },
    assets: [],
    metadata: {},
    extra: {},
  };
  await bucket.put(
    `releases/production/ios/${RUNTIME}/${UPDATE_ID}.json`,
    JSON.stringify(release)
  );
  await bucket.put(
    `channels/production/ios/${RUNTIME}/current.json`,
    JSON.stringify({
      mode: 'update',
      updateId: UPDATE_ID,
      updatedAt: '2026-11-25T15:00:00.000Z',
    })
  );
}

describe('GET /api/manifest RSA-SHA256 code signing', () => {
  it('signs manifest with RSA-SHA256 SFV header and honors expo-expect-signature', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const bucket = new MockR2Bucket();
    await seedRelease(bucket);

    const env: OtaWorkerEnv = {
      OTA_BUCKET: bucket,
      OTA_SIGNING_PRIVATE_KEY: privateKey,
      OTA_SIGNING_KEY_ID: 'baci-2026',
    };

    const resp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({
          'expo-expect-signature':
            'sig, keyid="baci-2026", alg="rsa-v1_5-sha256"',
        }),
      }),
      env
    );
    expect(resp.status).toBe(200);
    const parts = parseMultipartMixed(
      resp.headers.get('content-type'),
      await resp.text()
    );
    const sigHeader = parts[0]?.headers['expo-signature'];
    expect(sigHeader).toBeDefined();
    const match =
      /^sig="([A-Za-z0-9+/=]+)",\s*keyid="([^"]+)",\s*alg="rsa-v1_5-sha256"$/.exec(
        sigHeader ?? ''
      );
    expect(match).not.toBeNull();
    expect(match?.[2]).toBe('baci-2026');

    const verifier = createVerify('RSA-SHA256');
    verifier.update(parts[0]?.body ?? '', 'utf8');
    expect(verifier.verify(publicKey, match?.[1] ?? '', 'base64')).toBe(true);

    const boolTrueSig = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({
          'expo-expect-signature':
            'sig=?1, keyid="baci-2026", alg="rsa-v1_5-sha256"',
        }),
      }),
      env
    );
    expect(boolTrueSig.status).toBe(200);

    const boolFalseSig = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({
          'expo-expect-signature': 'sig=?0, keyid="baci-2026"',
        }),
      }),
      { OTA_BUCKET: bucket }
    );
    expect(boolFalseSig.status).toBe(200);

    for (const malformedHeader of [
      'keyid="baci-2026", alg="rsa-v1_5-sha256"',
      'sig="yes", keyid="baci-2026"',
      'sig, keyid="baci-2026',
    ]) {
      const badResp = await worker.fetch(
        new Request('https://ota.usebaci.com/api/manifest', {
          headers: createBaseHeaders({
            'expo-expect-signature': malformedHeader,
          }),
        }),
        env
      );
      expect(badResp.status, `Expected 406 for ${malformedHeader}`).toBe(406);
    }

    const mismatchKeyId = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({
          'expo-expect-signature': 'sig, keyid="wrong", alg="rsa-v1_5-sha256"',
        }),
      }),
      env
    );
    expect(mismatchKeyId.status).toBe(400);

    const unsupportedAlg = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({
          'expo-expect-signature': 'sig, keyid="baci-2026", alg="ecdsa-p256"',
        }),
      }),
      env
    );
    expect(unsupportedAlg.status).toBe(406);

    const unconfiguredSigning = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({
          'expo-expect-signature':
            'sig, keyid="baci-2026", alg="rsa-v1_5-sha256"',
        }),
      }),
      { OTA_BUCKET: bucket }
    );
    expect(unconfiguredSigning.status).toBe(500);
  });
});

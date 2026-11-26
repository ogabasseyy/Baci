import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { OtaWorkerEnv, StoredReleaseRecord } from '../src/types';
import { MockR2Bucket } from './helpers/mock-r2';
import { parseMultipartMixed } from './helpers/multipart-parser';

const UPDATE_ID = '1111111a-1111-4111-8111-11111111111a';
const EMBEDDED_ID = '2222222b-2222-4222-8222-22222222222b';
const VALID_BUNDLE_HASH = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const VALID_ASSET_HASH = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
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

async function seedRelease(bucket: MockR2Bucket, updateId = UPDATE_ID) {
  const release: StoredReleaseRecord = {
    id: updateId,
    createdAt: '2026-11-25T15:00:00.000Z',
    runtimeVersion: RUNTIME,
    channel: 'production',
    platform: 'ios',
    launchAsset: {
      hash: VALID_BUNDLE_HASH,
      key: 'bundle-key',
      contentType: 'application/javascript',
      fileExtension: '.hbc',
      r2Key: 'bundles/ios/abc123.hbc',
    },
    assets: [
      {
        hash: VALID_ASSET_HASH,
        key: 'md5-logo',
        contentType: 'image/png',
        fileExtension: '.png',
        r2Key: 'blobs/def456.png',
      },
    ],
    metadata: {},
    extra: {
      expoClient: {
        name: 'Ogabassey',
        slug: 'ogabassey-store',
      },
    },
  };
  await bucket.put(
    `releases/production/ios/${RUNTIME}/${updateId}.json`,
    JSON.stringify(release)
  );
  await bucket.put(
    `channels/production/ios/${RUNTIME}/current.json`,
    JSON.stringify({
      mode: 'update',
      updateId,
      updatedAt: '2026-11-25T15:00:00.000Z',
    })
  );
}

describe('GET /api/manifest (Expo Updates v1)', () => {
  it('validates required protocol headers', async () => {
    const env: OtaWorkerEnv = { OTA_BUCKET: new MockR2Bucket() };

    const missingProto = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: { 'expo-platform': 'ios', 'expo-runtime-version': RUNTIME },
      }),
      env
    );
    expect(missingProto.status).toBe(400);

    const wrongProto = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({ 'expo-protocol-version': '0' }),
      }),
      env
    );
    expect(wrongProto.status).toBe(406);

    const badPlatform = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({ 'expo-platform': 'web' }),
      }),
      env
    );
    expect(badPlatform.status).toBe(400);

    const badRuntime = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({ 'expo-runtime-version': '../evil' }),
      }),
      env
    );
    expect(badRuntime.status).toBe(400);

    const missingChannel = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: {
          'expo-protocol-version': '1',
          'expo-platform': 'ios',
          'expo-runtime-version': RUNTIME,
        },
      }),
      env
    );
    expect(missingChannel.status).toBe(400);
  });

  it('returns noUpdateAvailable directive when no release exists', async () => {
    const env: OtaWorkerEnv = { OTA_BUCKET: new MockR2Bucket() };
    const resp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders(),
      }),
      env
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get('expo-protocol-version')).toBe('1');
    expect(resp.headers.get('expo-sfv-version')).toBe('0');
    expect(resp.headers.get('cache-control')).toBe('private, no-store');

    const parts = parseMultipartMixed(
      resp.headers.get('content-type'),
      await resp.text()
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]?.name).toBe('directive');
    expect(JSON.parse(parts[0]?.body ?? '')).toEqual({
      type: 'noUpdateAvailable',
    });
  });

  it('serves active manifest and returns noUpdateAvailable when client is already current', async () => {
    const bucket = new MockR2Bucket();
    await seedRelease(bucket);
    const env: OtaWorkerEnv = { OTA_BUCKET: bucket };

    const manifestResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders(),
      }),
      env
    );
    expect(manifestResp.status).toBe(200);
    expect(manifestResp.headers.get('cache-control')).toBe('private, no-store');
    const parts = parseMultipartMixed(
      manifestResp.headers.get('content-type'),
      await manifestResp.text()
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]?.name).toBe('manifest');
    const manifest = JSON.parse(parts[0]?.body ?? '') as {
      id: string;
      launchAsset: { url: string; r2Key?: string };
      assets: { url: string; r2Key?: string }[];
    };
    expect(manifest.id).toBe(UPDATE_ID);
    expect(manifest.launchAsset.url).toBe(
      'https://ota.usebaci.com/api/assets/bundles/ios/abc123.hbc'
    );
    expect(manifest.launchAsset.r2Key).toBeUndefined();
    expect(manifest.assets[0]?.url).toBe(
      'https://ota.usebaci.com/api/assets/blobs/def456.png'
    );

    const sameUpdateResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({
          'expo-current-update-id': UPDATE_ID.toUpperCase(),
        }),
      }),
      env
    );
    const sameParts = parseMultipartMixed(
      sameUpdateResp.headers.get('content-type'),
      await sameUpdateResp.text()
    );
    expect(sameParts[0]?.name).toBe('directive');
    expect(JSON.parse(sameParts[0]?.body ?? '')).toEqual({
      type: 'noUpdateAvailable',
    });
  });

  it('serves rollBackToEmbedded directive and avoids loop when already embedded', async () => {
    const bucket = new MockR2Bucket();
    const commitTime = '2026-11-25T15:10:00.000Z';
    await bucket.put(
      `channels/production/ios/${RUNTIME}/current.json`,
      JSON.stringify({
        mode: 'rollback_to_embedded',
        commitTime,
        updatedAt: commitTime,
      })
    );
    const env: OtaWorkerEnv = { OTA_BUCKET: bucket };

    const rollbackResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({
          'expo-current-update-id': UPDATE_ID,
          'expo-embedded-update-id': EMBEDDED_ID,
        }),
      }),
      env
    );
    const rollbackParts = parseMultipartMixed(
      rollbackResp.headers.get('content-type'),
      await rollbackResp.text()
    );
    expect(rollbackParts[0]?.name).toBe('directive');
    expect(JSON.parse(rollbackParts[0]?.body ?? '')).toEqual({
      type: 'rollBackToEmbedded',
      parameters: { commitTime },
    });

    const alreadyEmbeddedResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({
          'expo-current-update-id': EMBEDDED_ID,
          'expo-embedded-update-id': EMBEDDED_ID,
        }),
      }),
      env
    );
    const embeddedParts = parseMultipartMixed(
      alreadyEmbeddedResp.headers.get('content-type'),
      await alreadyEmbeddedResp.text()
    );
    expect(JSON.parse(embeddedParts[0]?.body ?? '')).toEqual({
      type: 'noUpdateAvailable',
    });

    const missingEmbeddedResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({
          'expo-current-update-id': UPDATE_ID,
        }),
      }),
      env
    );
    const missingEmbeddedParts = parseMultipartMixed(
      missingEmbeddedResp.headers.get('content-type'),
      await missingEmbeddedResp.text()
    );
    expect(JSON.parse(missingEmbeddedParts[0]?.body ?? '')).toEqual({
      type: 'noUpdateAvailable',
    });
  });

  it('enforces root-origin routing and returns 404 for prefixed manifest paths', async () => {
    const bucket = new MockR2Bucket();
    await seedRelease(bucket);
    const env: OtaWorkerEnv = { OTA_BUCKET: bucket };

    const prefixedResp = await worker.fetch(
      new Request('https://ota.usebaci.com/mobile-ota/api/manifest', {
        headers: createBaseHeaders(),
      }),
      env
    );
    expect(prefixedResp.status).toBe(404);
  });

  it('negotiates Accept header and returns 406 when multipart/mixed is excluded', async () => {
    const bucket = new MockR2Bucket();
    await seedRelease(bucket);
    const env: OtaWorkerEnv = { OTA_BUCKET: bucket };

    const jsonOnlyResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({ accept: 'application/json' }),
      }),
      env
    );
    expect(jsonOnlyResp.status).toBe(406);

    const zeroQResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({
          accept: 'multipart/mixed;q=0, application/json',
        }),
      }),
      env
    );
    expect(zeroQResp.status).toBe(406);

    const exactExclusionOverWildcard = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({
          accept: 'multipart/mixed;q=0, */*;q=1',
        }),
      }),
      env
    );
    expect(exactExclusionOverWildcard.status).toBe(406);

    const wildcardOnlyResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({
          accept: '*/*',
        }),
      }),
      env
    );
    expect(wildcardOnlyResp.status).toBe(200);

    const mixedAcceptResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({
          accept: 'application/json, multipart/mixed;q=0.9',
        }),
      }),
      env
    );
    expect(mixedAcceptResp.status).toBe(200);

    const paramRangeResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders({
          accept: 'multipart/mixed; boundary=client; q=0, multipart/*; q=1',
        }),
      }),
      env
    );
    expect(paramRangeResp.status).toBe(200);

    const postManifestResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        method: 'POST',
      }),
      env
    );
    expect(postManifestResp.status).toBe(405);
    expect(postManifestResp.headers.get('allow')).toBe('GET');
  });

  it('returns controlled 500 JSON when R2 pointer or release JSON is malformed or invalid shape', async () => {
    const bucket = new MockR2Bucket();
    const env: OtaWorkerEnv = { OTA_BUCKET: bucket };
    const pointerKey = `channels/production/ios/${RUNTIME}/current.json`;
    const releaseKey = `releases/production/ios/${RUNTIME}/${UPDATE_ID}.json`;

    await bucket.put(pointerKey, 'not-json{');
    const corruptPtr = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders(),
      }),
      env
    );
    expect(corruptPtr.status).toBe(500);
    expect(await corruptPtr.json()).toMatchObject({
      error: expect.stringMatching(/pointer/i),
    });

    await bucket.put(pointerKey, JSON.stringify({ mode: 'update' }));
    const badShapePtr = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders(),
      }),
      env
    );
    expect(badShapePtr.status).toBe(500);

    await seedRelease(bucket);
    await bucket.put(releaseKey, '{broken-release-json');
    const corruptRel = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders(),
      }),
      env
    );
    expect(corruptRel.status).toBe(500);
    expect(await corruptRel.json()).toMatchObject({
      error: expect.stringMatching(/manifest/i),
    });

    await bucket.put(releaseKey, JSON.stringify({ id: UPDATE_ID }));
    const badShapeRel = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders(),
      }),
      env
    );
    expect(badShapeRel.status).toBe(500);

    await bucket.put(
      releaseKey,
      JSON.stringify({
        id: UPDATE_ID,
        createdAt: '2026-11-25T15:00:00.000Z',
        runtimeVersion: RUNTIME,
        channel: 'production',
        platform: 'ios',
        launchAsset: {
          hash: VALID_BUNDLE_HASH,
          key: 'bundle-key',
          contentType: 'application/javascript',
          r2Key: 'bundles/ios/abc123.hbc',
        },
        assets: [null],
        metadata: {},
        extra: {},
      })
    );
    const badAssetRel = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders(),
      }),
      env
    );
    expect(badAssetRel.status).toBe(500);

    await bucket.put(
      pointerKey,
      JSON.stringify({
        mode: 'update',
        updateId: UPDATE_ID,
        recentRollbacks: {},
      })
    );
    const badHistoryPtr = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders(),
      }),
      env
    );
    expect(badHistoryPtr.status).toBe(500);

    await seedRelease(bucket);
    await bucket.put(
      releaseKey,
      JSON.stringify({
        id: UPDATE_ID,
        createdAt: '2026-11-25T15:00:00.000Z',
        runtimeVersion: RUNTIME,
        channel: 'production',
        platform: 'android',
        launchAsset: {
          hash: VALID_BUNDLE_HASH,
          key: 'bundle-key',
          contentType: 'application/javascript',
          r2Key: 'bundles/ios/abc123.hbc',
        },
        assets: [],
        metadata: {},
        extra: {},
      })
    );
    const mismatchedRel = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: createBaseHeaders(),
      }),
      env
    );
    expect(mismatchedRel.status).toBe(500);
  });
});

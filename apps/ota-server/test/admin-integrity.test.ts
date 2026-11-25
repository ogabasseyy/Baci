import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { ChannelCurrentState, OtaWorkerEnv } from '../src/types';
import { MockR2Bucket } from './helpers/mock-r2';

const TOKEN = 'super-secret-ota-admin-token-12345';
const RUNTIME = '2.1.663-ios-sdk58-rn0880-splashmotion1';
const UPDATE_1 = '11111111-1111-4111-8111-111111111111';
const UPDATE_2 = '22222222-2222-4222-8222-222222222222';
const UPDATE_3 = '33333333-3333-4333-8333-333333333333';

function createEnv() {
  const bucket = new MockR2Bucket();
  const env: OtaWorkerEnv = {
    OTA_BUCKET: bucket,
    OTA_ADMIN_TOKEN: TOKEN,
  };
  return { bucket, env };
}

describe('admin upload integrity and concurrent publish CAS', () => {
  it('requires x-asset-sha256 on upload and rejects poisoned/mismatched R2 blobs on publish', async () => {
    const { bucket, env } = createEnv();
    const bytes = new TextEncoder().encode('real-bundle-bytes');
    const realHex = createHash('sha256').update(bytes).digest('hex');
    const realB64 = createHash('sha256').update(bytes).digest('base64url');
    const otherB64 = createHash('sha256')
      .update('other-bytes')
      .digest('base64url');

    const missingHeader = await worker.fetch(
      new Request(
        'https://ota.usebaci.com/api/admin/assets/bundles/ios/a.hbc',
        {
          method: 'PUT',
          headers: { authorization: `Bearer ${TOKEN}` },
          body: bytes,
        }
      ),
      env
    );
    expect(missingHeader.status).toBe(400);

    const putOk = await worker.fetch(
      new Request(
        'https://ota.usebaci.com/api/admin/assets/bundles/ios/a.hbc',
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'x-asset-sha256': realHex,
          },
          body: bytes,
        }
      ),
      env
    );
    expect(putOk.status).toBe(200);

    const headResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/assets/bundles/ios/a.hbc', {
        method: 'HEAD',
      }),
      env
    );
    expect(headResp.headers.get('x-asset-sha256')).toBe(realHex);

    const badFormatHash = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          platform: 'ios',
          runtimeVersion: RUNTIME,
          updateId: UPDATE_1,
          launchAsset: {
            hash: 'not-valid-sha256',
            key: realHex,
            contentType: 'application/javascript',
            r2Key: 'bundles/ios/a.hbc',
          },
        }),
      }),
      env
    );
    expect(badFormatHash.status).toBe(400);

    const poisonedMetaPublish = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          platform: 'ios',
          runtimeVersion: RUNTIME,
          updateId: UPDATE_1,
          launchAsset: {
            hash: otherB64,
            key: realHex,
            contentType: 'application/javascript',
            r2Key: 'bundles/ios/a.hbc',
          },
        }),
      }),
      env
    );
    expect(poisonedMetaPublish.status).toBe(400);

    // Also test legacy object without customMetadata: verify bytes directly.
    await bucket.put('assets/bundles/ios/legacy.hbc', bytes);
    const poisonedLegacyPublish = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          platform: 'ios',
          runtimeVersion: RUNTIME,
          updateId: UPDATE_1,
          launchAsset: {
            hash: otherB64,
            key: realHex,
            contentType: 'application/javascript',
            r2Key: 'bundles/ios/legacy.hbc',
          },
        }),
      }),
      env
    );
    expect(poisonedLegacyPublish.status).toBe(400);

    const validLegacyPublish = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          platform: 'ios',
          runtimeVersion: RUNTIME,
          updateId: UPDATE_1,
          launchAsset: {
            hash: realB64,
            key: realHex,
            contentType: 'application/javascript',
            r2Key: 'bundles/ios/legacy.hbc',
          },
        }),
      }),
      env
    );
    expect(validLegacyPublish.status).toBe(200);
  });

  it('retries channel pointer CAS on concurrent publish without losing previousUpdateId', async () => {
    const { bucket, env } = createEnv();
    const bytes = new TextEncoder().encode('cas-bundle');
    const shaHex = createHash('sha256').update(bytes).digest('hex');
    const shaB64 = createHash('sha256').update(bytes).digest('base64url');

    await worker.fetch(
      new Request(
        'https://ota.usebaci.com/api/admin/assets/bundles/ios/cas.hbc',
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'x-asset-sha256': shaHex,
          },
          body: bytes,
        }
      ),
      env
    );

    const publish = (updateId: string) =>
      worker.fetch(
        new Request('https://ota.usebaci.com/api/admin/publish', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            channel: 'production',
            platform: 'ios',
            runtimeVersion: RUNTIME,
            updateId,
            launchAsset: {
              hash: shaB64,
              key: shaHex,
              contentType: 'application/javascript',
              r2Key: 'bundles/ios/cas.hbc',
            },
          }),
        }),
        env
      );

    expect((await publish(UPDATE_1)).status).toBe(200);

    // Inject an interleaving write right before UPDATE_3 writes current.json.
    const pointerKey = `channels/production/ios/${RUNTIME}/current.json`;
    let injected = false;
    bucket.onBeforePut = (key) => {
      if (!injected && key === pointerKey) {
        injected = true;
        const entry = bucket.store.get(pointerKey);
        if (entry) {
          bucket.store.set(pointerKey, {
            ...entry,
            etag: 'concurrent-etag-99',
            bytes: new TextEncoder().encode(
              JSON.stringify({
                mode: 'update',
                updateId: UPDATE_2,
                previousUpdateId: UPDATE_1,
                updatedAt: '2026-11-25T16:00:00.000Z',
              })
            ),
          });
        }
      }
    };

    const resp3 = await publish(UPDATE_3);
    expect(resp3.status).toBe(200);
    expect(await resp3.json()).toMatchObject({
      ok: true,
      updateId: UPDATE_3,
      previousUpdateId: UPDATE_2,
    });

    const pointerObj = await bucket.get(pointerKey);
    const pointer = await pointerObj?.json<ChannelCurrentState>();
    expect(pointer).toMatchObject({
      mode: 'update',
      updateId: UPDATE_3,
      previousUpdateId: UPDATE_2,
    });
  });

  it('keeps assets and releases immutable on collision while allowing identical retries', async () => {
    const { env } = createEnv();
    const bytes = new TextEncoder().encode('immutable-bundle-v1');
    const shaHex = createHash('sha256').update(bytes).digest('hex');
    const shaB64 = createHash('sha256').update(bytes).digest('base64url');
    const assetUrl =
      'https://ota.usebaci.com/api/admin/assets/bundles/ios/imm.hbc';

    const putFirst = await worker.fetch(
      new Request(assetUrl, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/javascript',
          'x-asset-sha256': shaHex,
        },
        body: bytes,
      }),
      env
    );
    expect(putFirst.status).toBe(200);

    const putSameRetry = await worker.fetch(
      new Request(assetUrl, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/javascript',
          'x-asset-sha256': shaHex,
        },
        body: bytes,
      }),
      env
    );
    expect(putSameRetry.status).toBe(200);

    const otherBytes = new TextEncoder().encode('tampered-bundle-v1');
    const otherHex = createHash('sha256').update(otherBytes).digest('hex');
    const putConflictBytes = await worker.fetch(
      new Request(assetUrl, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/javascript',
          'x-asset-sha256': otherHex,
        },
        body: otherBytes,
      }),
      env
    );
    expect(putConflictBytes.status).toBe(409);

    const putConflictType = await worker.fetch(
      new Request(assetUrl, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'text/plain',
          'x-asset-sha256': shaHex,
        },
        body: bytes,
      }),
      env
    );
    expect(putConflictType.status).toBe(409);

    const basePublishBody = {
      channel: 'production',
      platform: 'ios',
      runtimeVersion: RUNTIME,
      updateId: UPDATE_1,
      createdAt: '2026-11-25T12:00:00.000Z',
      launchAsset: {
        hash: shaB64,
        key: shaHex,
        contentType: 'application/javascript',
        r2Key: 'bundles/ios/imm.hbc',
      },
    };
    const pub1 = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(basePublishBody),
      }),
      env
    );
    expect(pub1.status).toBe(200);

    const pubRetry = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(basePublishBody),
      }),
      env
    );
    expect(pubRetry.status).toBe(200);

    // Retry without caller-supplied createdAt must also reuse stored timestamp.
    const { createdAt: _omitted, ...publishWithoutCreatedAt } = basePublishBody;
    const pubRetryNoCreatedAt = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(publishWithoutCreatedAt),
      }),
      env
    );
    expect(pubRetryNoCreatedAt.status).toBe(200);

    const pubConflict = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ...basePublishBody,
          metadata: { tag: 'mutated' },
        }),
      }),
      env
    );
    expect(pubConflict.status).toBe(409);

    // JSON representation comparison: -0 serializes as 0 on retry and must still match.
    const negZeroBody = JSON.stringify({
      ...basePublishBody,
      updateId: UPDATE_2,
      createdAt: '2026-11-25T12:05:00.000Z',
      extra: { score: -0 },
    });
    expect(
      (
        await worker.fetch(
          new Request('https://ota.usebaci.com/api/admin/publish', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${TOKEN}`,
              'content-type': 'application/json',
            },
            body: negZeroBody.replace('"score":0', '"score":-0'),
          }),
          env
        )
      ).status
    ).toBe(200);
    expect(
      (
        await worker.fetch(
          new Request('https://ota.usebaci.com/api/admin/publish', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${TOKEN}`,
              'content-type': 'application/json',
            },
            body: negZeroBody.replace('"score":0', '"score":-0'),
          }),
          env
        )
      ).status
    ).toBe(200);
  });

  it('prevents publish CAS retry from moving channel updatedAt backward after a newer concurrent publish', async () => {
    const { bucket, env } = createEnv();
    const bytes = new TextEncoder().encode('monotonic-cas-bundle');
    const shaHex = createHash('sha256').update(bytes).digest('hex');
    const shaB64 = createHash('sha256').update(bytes).digest('base64url');
    await worker.fetch(
      new Request(
        'https://ota.usebaci.com/api/admin/assets/bundles/ios/mono.hbc',
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'x-asset-sha256': shaHex,
          },
          body: bytes,
        }
      ),
      env
    );

    const pointerKey = `channels/production/ios/${RUNTIME}/current.json`;
    const newerTimestamp = '2026-11-25T16:30:00.000Z';
    let injected = false;
    bucket.onBeforePut = (key) => {
      if (!injected && key === pointerKey) {
        injected = true;
        bucket.store.set(pointerKey, {
          etag: 'newer-concurrent-pub',
          bytes: new TextEncoder().encode(
            JSON.stringify({
              mode: 'update',
              updateId: UPDATE_2,
              activeSourceUpdateId: UPDATE_2,
              updatedAt: newerTimestamp,
            })
          ),
        });
      }
    };

    const staleRetryResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
          updateId: UPDATE_1,
          createdAt: '2026-11-25T16:00:00.000Z',
          launchAsset: {
            hash: shaB64,
            key: shaHex,
            contentType: 'application/javascript',
            r2Key: 'bundles/ios/mono.hbc',
          },
        }),
      }),
      env
    );
    expect(staleRetryResp.status).toBe(409);
    expect(await staleRetryResp.json()).toMatchObject({
      code: 'STALE_TIMESTAMP_CONFLICT',
    });

    const pointer = await (
      await bucket.get(pointerKey)
    )?.json<ChannelCurrentState>();
    expect(pointer).toMatchObject({
      mode: 'update',
      updateId: UPDATE_2,
      updatedAt: newerTimestamp,
    });

    // Retrying with a fresh attempt (omitted updateId and createdAt) succeeds cleanly after T2.
    const recoveryResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
          launchAsset: {
            hash: shaB64,
            key: shaHex,
            contentType: 'application/javascript',
            r2Key: 'bundles/ios/mono.hbc',
          },
        }),
      }),
      env
    );
    expect(recoveryResp.status).toBe(200);
    const recoveredPointer = await (
      await bucket.get(pointerKey)
    )?.json<ChannelCurrentState>();
    expect(recoveredPointer).toMatchObject({
      mode: 'update',
      previousUpdateId: UPDATE_2,
    });
    expect(Date.parse(recoveredPointer?.updatedAt ?? '')).toBeGreaterThan(
      Date.parse(newerTimestamp)
    );
  });

  it('returns controlled 500 JSON when channel pointer JSON is corrupt on publish', async () => {
    const { bucket, env } = createEnv();
    const bytes = new TextEncoder().encode('corrupt-ptr-bundle');
    const shaHex = createHash('sha256').update(bytes).digest('hex');
    const shaB64 = createHash('sha256').update(bytes).digest('base64url');
    const pointerKey = `channels/production/ios/${RUNTIME}/current.json`;

    await bucket.put(`bundles/ios/corrupt.hbc`, bytes, {
      httpMetadata: { contentType: 'application/javascript' },
      customMetadata: { sha256: shaHex },
    });
    await bucket.put(pointerKey, '{corrupt-pointer-json');

    const resp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
          launchAsset: {
            hash: shaB64,
            key: shaHex,
            contentType: 'application/javascript',
            r2Key: 'bundles/ios/corrupt.hbc',
          },
        }),
      }),
      env
    );
    expect(resp.status).toBe(500);
    expect(await resp.json()).toMatchObject({
      error: expect.stringMatching(/pointer/i),
    });
  });
});

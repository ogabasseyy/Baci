import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { OtaWorkerEnv } from '../src/types';
import { MockR2Bucket } from './helpers/mock-r2';
import { parseMultipartMixed } from './helpers/multipart-parser';

const TOKEN = 'super-secret-ota-admin-token-12345';
const RUNTIME = '2.1.663-ios-sdk58-rn0880-splashmotion1';
const UPDATE_A = '11111111-1111-4111-8111-111111111111';
const UPDATE_B = '22222222-2222-4222-8222-222222222222';

async function setupChannelWithTwoReleases() {
  const bucket = new MockR2Bucket();
  const env: OtaWorkerEnv = {
    OTA_BUCKET: bucket,
    OTA_ADMIN_TOKEN: TOKEN,
  };

  const bytesA = new TextEncoder().encode('bundle-a');
  const hexA = createHash('sha256').update(bytesA).digest('hex');
  const b64A = createHash('sha256').update(bytesA).digest('base64url');
  const bytesB = new TextEncoder().encode('bundle-b');
  const hexB = createHash('sha256').update(bytesB).digest('hex');
  const b64B = createHash('sha256').update(bytesB).digest('base64url');

  const upA = await worker.fetch(
    new Request('https://ota.usebaci.com/api/admin/assets/bundles/ios/a.hbc', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/javascript',
        'x-asset-sha256': hexA,
      },
      body: bytesA,
    }),
    env
  );
  expect(upA.status).toBe(200);
  const upB = await worker.fetch(
    new Request('https://ota.usebaci.com/api/admin/assets/bundles/ios/b.hbc', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/javascript',
        'x-asset-sha256': hexB,
      },
      body: bytesB,
    }),
    env
  );
  expect(upB.status).toBe(200);

  const setupBaseMs = Date.now();
  const timestampA = new Date(setupBaseMs - 120_000).toISOString();
  const timestampB = new Date(setupBaseMs - 60_000).toISOString();

  const pubA = await worker.fetch(
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
        updateId: UPDATE_A,
        createdAt: timestampA,
        metadata: { release: 'a' },
        launchAsset: {
          hash: b64A,
          key: hexA,
          contentType: 'application/javascript',
          r2Key: 'bundles/ios/a.hbc',
        },
      }),
    }),
    env
  );
  expect(pubA.status).toBe(200);

  const pubB = await worker.fetch(
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
        updateId: UPDATE_B,
        createdAt: timestampB,
        metadata: { release: 'b' },
        launchAsset: {
          hash: b64B,
          key: hexB,
          contentType: 'application/javascript',
          r2Key: 'bundles/ios/b.hbc',
        },
      }),
    }),
    env
  );
  expect(pubB.status).toBe(200);

  return { bucket, env, b64A, timestampB };
}

describe('admin payload validation and rollback safety', () => {
  it('rejects explicitly blank/non-string channels and non-string manifest metadata values', async () => {
    const { env, b64A } = await setupChannelWithTwoReleases();
    const validLaunchAsset = {
      hash: b64A,
      key: 'k',
      contentType: 'application/javascript',
      r2Key: 'bundles/ios/a.hbc',
    };

    for (const badChannel of ['', '   ', 123, null]) {
      const pubResp = await worker.fetch(
        new Request('https://ota.usebaci.com/api/admin/publish', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            channel: badChannel,
            platform: 'ios',
            runtimeVersion: RUNTIME,
            launchAsset: validLaunchAsset,
          }),
        }),
        env
      );
      expect(pubResp.status).toBe(400);

      const rbResp = await worker.fetch(
        new Request('https://ota.usebaci.com/api/admin/rollback', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            channel: badChannel,
            platform: 'ios',
            runtimeVersion: RUNTIME,
            targetUpdateId: UPDATE_A,
          }),
        }),
        env
      );
      expect(rbResp.status).toBe(400);
    }

    const badMetaResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          platform: 'ios',
          runtimeVersion: RUNTIME,
          launchAsset: validLaunchAsset,
          metadata: { rollout: true },
        }),
      }),
      env
    );
    expect(badMetaResp.status).toBe(400);
  });

  it('treats explicit rollback to already-active release as no-op and preserves fallback', async () => {
    const { env } = await setupChannelWithTwoReleases();

    const noopRollback = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
          targetUpdateId: UPDATE_B,
        }),
      }),
      env
    );
    expect(noopRollback.status).toBe(200);
    expect(await noopRollback.json()).toMatchObject({
      ok: true,
      mode: 'update',
      updateId: UPDATE_B,
    });

    const targetlessAfterNoop = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'idempotency-key': 'rollback-after-noop-1',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
        }),
      }),
      env
    );
    expect(targetlessAfterNoop.status).toBe(200);
    expect(await targetlessAfterNoop.json()).toMatchObject({
      ok: true,
      mode: 'update',
      rolledBackToUpdateId: UPDATE_A,
    });
  });

  it('republishes A with a fresh UUID and newer createdAt for clients on B, and keeps targetless rollback idempotent', async () => {
    const { env, b64A, timestampB } = await setupChannelWithTwoReleases();

    const missingKeyResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
        }),
      }),
      env
    );
    expect(missingKeyResp.status).toBe(400);

    const firstRb = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'idempotency-key': 'retry-safe-rollback-1',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
        }),
      }),
      env
    );
    expect(firstRb.status).toBe(200);
    const firstJsonUnknown: unknown = await firstRb.json();
    if (
      typeof firstJsonUnknown !== 'object' ||
      firstJsonUnknown === null ||
      !('updateId' in firstJsonUnknown) ||
      typeof firstJsonUnknown.updateId !== 'string' ||
      !('rolledBackToUpdateId' in firstJsonUnknown) ||
      typeof firstJsonUnknown.rolledBackToUpdateId !== 'string'
    ) {
      throw new Error('Expected rollback response to include string updateId');
    }
    const rollbackId = firstJsonUnknown.updateId;
    expect(rollbackId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(firstJsonUnknown.rolledBackToUpdateId).toBe(UPDATE_A);
    expect(rollbackId).not.toBe(UPDATE_A);
    expect(rollbackId).not.toBe(UPDATE_B);

    // Retry with same idempotency-key must NOT flip back to UPDATE_B.
    const secondRb = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'idempotency-key': 'retry-safe-rollback-1',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
        }),
      }),
      env
    );
    expect(secondRb.status).toBe(200);
    expect(await secondRb.json()).toEqual(firstJsonUnknown);

    // Client currently running UPDATE_B (createdAt 2026-11-25T12:00:00.000Z)
    // must receive a new update ID with A's content and createdAt > B's createdAt.
    const manifestResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: {
          'expo-protocol-version': '1',
          'expo-platform': 'ios',
          'expo-runtime-version': RUNTIME,
          'expo-channel-name': 'production',
          'expo-current-update-id': UPDATE_B,
        },
      }),
      env
    );
    expect(manifestResp.status).toBe(200);
    const parts = parseMultipartMixed(
      manifestResp.headers.get('content-type'),
      await manifestResp.text()
    );
    const parsedManifestUnknown: unknown = JSON.parse(parts[0]?.body ?? '');
    if (
      typeof parsedManifestUnknown !== 'object' ||
      parsedManifestUnknown === null ||
      !('id' in parsedManifestUnknown) ||
      typeof parsedManifestUnknown.id !== 'string' ||
      !('createdAt' in parsedManifestUnknown) ||
      typeof parsedManifestUnknown.createdAt !== 'string' ||
      !('launchAsset' in parsedManifestUnknown) ||
      typeof parsedManifestUnknown.launchAsset !== 'object' ||
      parsedManifestUnknown.launchAsset === null ||
      !('hash' in parsedManifestUnknown.launchAsset) ||
      typeof parsedManifestUnknown.launchAsset.hash !== 'string' ||
      !('metadata' in parsedManifestUnknown)
    ) {
      throw new Error(
        'Expected manifest JSON object with id, createdAt, launchAsset.hash, metadata'
      );
    }
    expect(parsedManifestUnknown.id).toBe(rollbackId);
    expect(parsedManifestUnknown.launchAsset.hash).toBe(b64A);
    expect(parsedManifestUnknown.metadata).toEqual({ release: 'a' });
    expect(Date.parse(parsedManifestUnknown.createdAt)).toBeGreaterThan(
      Date.parse(timestampB)
    );
  });

  it('keeps rollback CAS pure without creating orphan releases under pointer contention', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T14:00:00.000Z'));
    try {
      const { bucket, env } = await setupChannelWithTwoReleases();
      const UPDATE_C = '33333333-3333-4333-8333-333333333333';
      const pointerKey = `channels/production/ios/${RUNTIME}/current.json`;
      const releasePrefix = `releases/production/ios/${RUNTIME}/`;

      const releasesBefore = [...bucket.store.keys()].filter((k) =>
        k.startsWith(releasePrefix)
      ).length;

      let injected = false;
      bucket.onBeforePut = (key) => {
        if (!injected && key === pointerKey) {
          injected = true;
          const entry = bucket.store.get(pointerKey);
          if (entry) {
            bucket.store.set(pointerKey, {
              ...entry,
              etag: 'concurrent-publish-c',
              bytes: new TextEncoder().encode(
                JSON.stringify({
                  mode: 'update',
                  updateId: UPDATE_C,
                  activeSourceUpdateId: UPDATE_C,
                  previousUpdateId: UPDATE_B,
                  updatedAt: '2026-11-25T13:00:00.000Z',
                })
              ),
            });
          }
        }
      };

      const rbResp = await worker.fetch(
        new Request('https://ota.usebaci.com/api/admin/rollback', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'application/json',
            'idempotency-key': 'cas-contention-rb-1',
          },
          body: JSON.stringify({
            channel: 'production',
            platform: 'ios',
            runtimeVersion: RUNTIME,
            targetUpdateId: UPDATE_A,
          }),
        }),
        env
      );
      expect(rbResp.status).toBe(200);
      const rbBodyUnknown: unknown = await rbResp.json();
      if (
        typeof rbBodyUnknown !== 'object' ||
        rbBodyUnknown === null ||
        !('updateId' in rbBodyUnknown) ||
        typeof rbBodyUnknown.updateId !== 'string' ||
        !('rolledBackToUpdateId' in rbBodyUnknown) ||
        typeof rbBodyUnknown.rolledBackToUpdateId !== 'string'
      ) {
        throw new Error(
          'Expected rollback result with updateId and rolledBackToUpdateId'
        );
      }
      expect(rbBodyUnknown.rolledBackToUpdateId).toBe(UPDATE_A);

      const releasesAfter = [...bucket.store.keys()].filter((k) =>
        k.startsWith(releasePrefix)
      ).length;
      // Exactly 1 new release created despite CAS retry.
      expect(releasesAfter - releasesBefore).toBe(1);

      const pointerObj = await bucket.get(pointerKey);
      const pointerUnknown: unknown = await pointerObj?.json();
      if (
        typeof pointerUnknown !== 'object' ||
        pointerUnknown === null ||
        !('updateId' in pointerUnknown) ||
        !('previousUpdateId' in pointerUnknown)
      ) {
        throw new Error(
          'Expected pointer object with updateId and previousUpdateId'
        );
      }
      expect(pointerUnknown.updateId).toBe(rbBodyUnknown.updateId);
      expect(pointerUnknown.previousUpdateId).toBe(UPDATE_C);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects rollback with 409 when a concurrent publish advances timestamp past prepared rollback', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T12:30:00.000Z'));
    try {
      const { bucket, env } = await setupChannelWithTwoReleases();
      const UPDATE_C = '33333333-3333-4333-8333-333333333333';
      const pointerKey = `channels/production/ios/${RUNTIME}/current.json`;

      let injected = false;
      bucket.onBeforePut = (key) => {
        if (!injected && key === pointerKey) {
          injected = true;
          const entry = bucket.store.get(pointerKey);
          if (entry) {
            bucket.store.set(pointerKey, {
              ...entry,
              etag: 'newer-concurrent-c',
              bytes: new TextEncoder().encode(
                JSON.stringify({
                  mode: 'update',
                  updateId: UPDATE_C,
                  activeSourceUpdateId: UPDATE_C,
                  previousUpdateId: UPDATE_B,
                  updatedAt: '2026-11-25T13:00:00.000Z',
                })
              ),
            });
          }
        }
      };

      const rbResp = await worker.fetch(
        new Request('https://ota.usebaci.com/api/admin/rollback', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'application/json',
            'idempotency-key': 'cas-timestamp-conflict-1',
          },
          body: JSON.stringify({
            channel: 'production',
            platform: 'ios',
            runtimeVersion: RUNTIME,
            targetUpdateId: UPDATE_A,
          }),
        }),
        env
      );
      expect(rbResp.status).toBe(409);
      expect(await rbResp.json()).toMatchObject({
        error: expect.stringMatching(/advanced channel timestamp/i),
      });
      const pointerAfterConflict = await (await bucket.get(pointerKey))?.json<{
        updateId: string;
      }>();
      expect(pointerAfterConflict?.updateId).toBe(UPDATE_C);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves keyed rollback idempotency even after subsequent publishes move the channel', async () => {
    const { bucket, env, b64A } = await setupChannelWithTwoReleases();
    const UPDATE_C = '33333333-3333-4333-8333-333333333333';
    const pointerKey = `channels/production/ios/${RUNTIME}/current.json`;

    const rb1 = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'idempotency-key': 'survives-intervening-publish-1',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
        }),
      }),
      env
    );
    expect(rb1.status).toBe(200);
    const rb1Body = await rb1.json();

    const pubC = await worker.fetch(
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
          updateId: UPDATE_C,
          launchAsset: {
            hash: b64A,
            key: 'k',
            contentType: 'application/javascript',
            r2Key: 'bundles/ios/a.hbc',
          },
        }),
      }),
      env
    );
    expect(pubC.status).toBe(200);

    // Retrying old rollback key must return original result and leave UPDATE_C active.
    const rbReplayAfterC = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'idempotency-key': 'survives-intervening-publish-1',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
        }),
      }),
      env
    );
    expect(rbReplayAfterC.status).toBe(200);
    expect(await rbReplayAfterC.json()).toEqual(rb1Body);

    const pointer = await (await bucket.get(pointerKey))?.json<{
      updateId: string;
    }>();
    expect(pointer?.updateId).toBe(UPDATE_C);
  });

  it('rejects replaying an Idempotency-Key with a different rollback payload (409)', async () => {
    const { env } = await setupChannelWithTwoReleases();

    const firstResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'idempotency-key': 'shared-key-mismatch-1',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
          targetUpdateId: UPDATE_A,
        }),
      }),
      env
    );
    expect(firstResp.status).toBe(200);

    const mismatchTarget = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'idempotency-key': 'shared-key-mismatch-1',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
          targetUpdateId: UPDATE_B,
        }),
      }),
      env
    );
    expect(mismatchTarget.status).toBe(409);

    const mismatchEmbedded = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'idempotency-key': 'shared-key-mismatch-1',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
          toEmbedded: true,
        }),
      }),
      env
    );
    expect(mismatchEmbedded.status).toBe(409);
  });

  it('returns controlled 500 JSON when pointer or source release JSON is corrupt on rollback', async () => {
    const { bucket, env } = await setupChannelWithTwoReleases();
    const pointerKey = `channels/production/ios/${RUNTIME}/current.json`;
    const releaseKey = `releases/production/ios/${RUNTIME}/${UPDATE_A}.json`;

    await bucket.put(releaseKey, '{corrupt-release-json');
    const corruptReleaseResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
          targetUpdateId: UPDATE_A,
        }),
      }),
      env
    );
    expect(corruptReleaseResp.status).toBe(500);
    expect(await corruptReleaseResp.json()).toMatchObject({
      error: expect.stringMatching(/manifest/i),
    });

    await bucket.put(pointerKey, '{corrupt-pointer-json');
    const corruptPointerResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
          toEmbedded: true,
        }),
      }),
      env
    );
    expect(corruptPointerResp.status).toBe(500);
    expect(await corruptPointerResp.json()).toMatchObject({
      error: expect.stringMatching(/pointer/i),
    });
  });

  it('exposes release sourceSha metadata via authenticated GET /api/admin/release', async () => {
    const { bucket, env } = await setupChannelWithTwoReleases();
    const sourceSha = 'a'.repeat(40);
    const releaseKey = `releases/production/ios/${RUNTIME}/${UPDATE_A}.json`;
    const existing = await (await bucket.get(releaseKey))?.json<
      Record<string, unknown>
    >();
    await bucket.put(releaseKey, JSON.stringify({ ...existing, sourceSha }));

    const queryUrl = `https://ota.usebaci.com/api/admin/release?channel=production&platform=ios&runtimeVersion=${encodeURIComponent(RUNTIME)}&updateId=${UPDATE_A}`;
    const unauthResp = await worker.fetch(new Request(queryUrl), env);
    expect(unauthResp.status).toBe(401);

    const okResp = await worker.fetch(
      new Request(queryUrl, {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      env
    );
    expect(okResp.status).toBe(200);
    expect(await okResp.json()).toMatchObject({
      id: UPDATE_A,
      channel: 'production',
      platform: 'ios',
      runtimeVersion: RUNTIME,
      sourceSha,
    });
  });

  it('persists keyed no-op rollbacks and survives post-commit cleanup deletion failures', async () => {
    const { bucket, env } = await setupChannelWithTwoReleases();
    const pointerKey = `channels/production/ios/${RUNTIME}/current.json`;

    const keyedNoop = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'idempotency-key': 'noop-persisted-key-1',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
          targetUpdateId: UPDATE_B,
        }),
      }),
      env
    );
    expect(keyedNoop.status).toBe(200);
    const keyedNoopBody = await keyedNoop.json();
    expect(keyedNoopBody).toMatchObject({ ok: true, updateId: UPDATE_B });

    const pointerAfterNoop = await (await bucket.get(pointerKey))?.json<{
      lastRollback?: { key: string };
    }>();
    expect(pointerAfterNoop?.lastRollback?.key).toBe('noop-persisted-key-1');

    const replayNoop = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'idempotency-key': 'noop-persisted-key-1',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
          targetUpdateId: UPDATE_B,
        }),
      }),
      env
    );
    expect(replayNoop.status).toBe(200);
    expect(await replayNoop.json()).toEqual(keyedNoopBody);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pointerKeyCas = `channels/production/ios/${RUNTIME}/current.json`;
    const releasePrefix = `releases/production/ios/${RUNTIME}/`;
    const releasesBeforeAbort = [...bucket.store.keys()].filter((k) =>
      k.startsWith(releasePrefix)
    ).length;
    const origDelete = bucket.delete?.bind(bucket);
    bucket.onBeforePut = (key) => {
      if (key === pointerKeyCas) {
        bucket.onBeforePut = undefined;
        bucket.store.set(pointerKeyCas, {
          etag: 'advance-for-abort-cleanup',
          bytes: new TextEncoder().encode(
            JSON.stringify({
              mode: 'update',
              updateId: UPDATE_B,
              activeSourceUpdateId: UPDATE_B,
              updatedAt: new Date(Date.now() + 60_000).toISOString(),
            })
          ),
        });
      }
    };
    const abortCleanResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
          targetUpdateId: UPDATE_A,
        }),
      }),
      env
    );
    expect(abortCleanResp.status).toBe(409);
    const releasesAfterAbort = [...bucket.store.keys()].filter((k) =>
      k.startsWith(releasePrefix)
    ).length;
    expect(releasesAfterAbort).toBe(releasesBeforeAbort);

    bucket.onBeforePut = (key) => {
      if (key === pointerKeyCas) {
        bucket.onBeforePut = undefined;
        bucket.store.set(pointerKeyCas, {
          etag: 'advance-for-delete-outage',
          bytes: new TextEncoder().encode(
            JSON.stringify({
              mode: 'update',
              updateId: UPDATE_B,
              activeSourceUpdateId: UPDATE_B,
              updatedAt: new Date(Date.now() + 120_000).toISOString(),
            })
          ),
        });
      }
    };
    bucket.delete = async () => {
      throw new Error('R2 transient delete outage');
    };
    try {
      const rbWithDeleteOutage = await worker.fetch(
        new Request('https://ota.usebaci.com/api/admin/rollback', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            channel: 'production',
            platform: 'ios',
            runtimeVersion: RUNTIME,
            targetUpdateId: UPDATE_A,
          }),
        }),
        env
      );
      expect(rbWithDeleteOutage.status).toBe(409);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      bucket.delete = origDelete;
      warnSpy.mockRestore();
    }
  });
});

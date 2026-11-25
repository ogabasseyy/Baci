import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { OtaWorkerEnv } from '../src/types';
import { MockR2Bucket } from './helpers/mock-r2';
import { parseMultipartMixed } from './helpers/multipart-parser';

const TOKEN = 'super-secret-ota-admin-token-12345';
const RUNTIME = '2.1.663-ios-sdk58-rn0880-splashmotion1';
const UPDATE_1 = '11111111-1111-4111-8111-111111111111';
const UPDATE_2 = '22222222-2222-4222-8222-222222222222';
const SOURCE_SHA = 'a'.repeat(40);

function createEnv() {
  const bucket = new MockR2Bucket();
  const env: OtaWorkerEnv = {
    OTA_BUCKET: bucket,
    OTA_ADMIN_TOKEN: TOKEN,
  };
  return { bucket, env };
}

describe('admin publish and rollback endpoints', () => {
  it('enforces timing-safe bearer auth and fails closed when unconfigured', async () => {
    const { env } = createEnv();

    const unconfigured = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: '{}',
      }),
      { OTA_BUCKET: env.OTA_BUCKET }
    );
    expect(unconfigured.status).toBe(503);

    const noAuth = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        body: '{}',
      }),
      env
    );
    expect(noAuth.status).toBe(401);

    const wrongSameLen = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${'x'.repeat(TOKEN.length)}`,
        },
        body: '{}',
      }),
      env
    );
    expect(wrongSameLen.status).toBe(401);

    const wrongDiffLen = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/assets/blobs/a.png', {
        method: 'PUT',
        headers: { authorization: 'Bearer short' },
        body: 'hi',
      }),
      env
    );
    expect(wrongDiffLen.status).toBe(401);
  });

  it('uploads assets with SHA-256 verification and rejects missing R2 blobs on publish', async () => {
    const { env } = createEnv();
    const bytes = new TextEncoder().encode('console.log("hello ota");');
    const shaHex = createHash('sha256').update(bytes).digest('hex');
    const shaBase64Url = createHash('sha256').update(bytes).digest('base64url');

    const badChecksum = await worker.fetch(
      new Request(
        'https://ota.usebaci.com/api/admin/assets/bundles/ios/b.hbc',
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'application/javascript',
            'x-asset-sha256': '0'.repeat(64),
          },
          body: bytes,
        }
      ),
      env
    );
    expect(badChecksum.status).toBe(400);

    const missingBlobPublish = await worker.fetch(
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
            hash: shaBase64Url,
            key: shaHex,
            contentType: 'application/javascript',
            r2Key: 'bundles/ios/b.hbc',
          },
        }),
      }),
      env
    );
    expect(missingBlobPublish.status).toBe(400);

    const uploadResp = await worker.fetch(
      new Request(
        'https://ota.usebaci.com/api/admin/assets/bundles/ios/b.hbc',
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'application/javascript',
            'x-asset-sha256': shaHex,
          },
          body: bytes,
        }
      ),
      env
    );
    expect(uploadResp.status).toBe(200);

    const publishResp = await worker.fetch(
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
          sourceSha: SOURCE_SHA,
          launchAsset: {
            hash: shaBase64Url,
            key: shaHex,
            contentType: 'application/javascript',
            fileExtension: '.hbc',
            r2Key: 'bundles/ios/b.hbc',
          },
        }),
      }),
      env
    );
    expect(publishResp.status).toBe(200);
    expect(await publishResp.json()).toMatchObject({
      ok: true,
      updateId: UPDATE_1,
      platform: 'ios',
      channel: 'production',
    });
  });

  it('supports publishing successive updates and rolling back to previous or embedded', async () => {
    const { env } = createEnv();
    const assetBytes = new TextEncoder().encode('bundle-v1');
    const shaHex = createHash('sha256').update(assetBytes).digest('hex');
    const shaB64 = createHash('sha256').update(assetBytes).digest('base64url');

    await worker.fetch(
      new Request(
        'https://ota.usebaci.com/api/admin/assets/bundles/ios/v1.hbc',
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'x-asset-sha256': shaHex,
          },
          body: assetBytes,
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
              r2Key: 'bundles/ios/v1.hbc',
            },
          }),
        }),
        env
      );

    expect((await publish(UPDATE_1)).status).toBe(200);
    const pub2 = await publish(UPDATE_2);
    expect(pub2.status).toBe(200);
    expect(await pub2.json()).toMatchObject({
      updateId: UPDATE_2,
      previousUpdateId: UPDATE_1,
    });

    const rollbackAuto = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/rollback', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'idempotency-key': 'rollback-auto-key-1',
        },
        body: JSON.stringify({
          channel: 'production',
          platform: 'ios',
          runtimeVersion: RUNTIME,
        }),
      }),
      env
    );
    expect(rollbackAuto.status).toBe(200);
    const rollbackBody: unknown = await rollbackAuto.json();
    expect(rollbackBody).toMatchObject({
      ok: true,
      mode: 'update',
      rolledBackToUpdateId: UPDATE_1,
    });
    if (
      typeof rollbackBody !== 'object' ||
      rollbackBody === null ||
      !('updateId' in rollbackBody) ||
      typeof rollbackBody.updateId !== 'string'
    ) {
      throw new Error('Expected rollback response to include string updateId');
    }
    expect(rollbackBody.updateId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(rollbackBody.updateId).not.toBe(UPDATE_1);
    expect(rollbackBody.updateId).not.toBe(UPDATE_2);

    const rollbackMissing = await worker.fetch(
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
          targetUpdateId: '33333333-3333-4333-8333-333333333333',
        }),
      }),
      env
    );
    expect(rollbackMissing.status).toBe(404);

    const rollbackEmbedded = await worker.fetch(
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
    expect(rollbackEmbedded.status).toBe(200);

    const manifestAfterRollback = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: {
          'expo-protocol-version': '1',
          'expo-platform': 'ios',
          'expo-runtime-version': RUNTIME,
          'expo-channel-name': 'production',
          'expo-current-update-id': UPDATE_2,
          'expo-embedded-update-id': '44444444-4444-4444-8444-444444444444',
        },
      }),
      env
    );
    const parts = parseMultipartMixed(
      manifestAfterRollback.headers.get('content-type'),
      await manifestAfterRollback.text()
    );
    expect(JSON.parse(parts[0]?.body ?? '')).toMatchObject({
      type: 'rollBackToEmbedded',
    });
  });
});

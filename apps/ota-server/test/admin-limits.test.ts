import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { OtaWorkerEnv } from '../src/types';
import {
  MAX_ASSET_UPLOAD_BYTES,
  MAX_MANIFEST_ASSETS,
  readBodyBytesWithLimit,
} from '../src/validation';
import { MockR2Bucket } from './helpers/mock-r2';
import { parseMultipartMixed } from './helpers/multipart-parser';

const TOKEN = 'super-secret-ota-admin-token-12345';
const RUNTIME = '2.1.663-ios-sdk58-rn0880-splashmotion1';

function createEnv() {
  const bucket = new MockR2Bucket();
  const env: OtaWorkerEnv = {
    OTA_BUCKET: bucket,
    OTA_ADMIN_TOKEN: TOKEN,
  };
  return { env };
}

describe('admin payload size and count limits', () => {
  it('enforces streaming byte limit and rejects oversized asset upload with 413', async () => {
    const { env } = createEnv();

    const oversizedHeaderResp = await worker.fetch(
      new Request(
        'https://ota.usebaci.com/api/admin/assets/bundles/ios/huge.hbc',
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-length': String(MAX_ASSET_UPLOAD_BYTES + 1),
            'x-asset-sha256': '0'.repeat(64),
          },
          body: 'small-body-with-large-declared-length',
        }
      ),
      env
    );
    expect(oversizedHeaderResp.status).toBe(413);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(600));
        controller.enqueue(new Uint8Array(600));
        controller.close();
      },
    });
    const streamedInit: RequestInit & { duplex: 'half' } = {
      method: 'PUT',
      body: stream,
      duplex: 'half',
    };
    const streamedReq = new Request(
      'https://ota.usebaci.com/upload',
      streamedInit
    );
    await expect(
      readBodyBytesWithLimit(streamedReq, 1024)
    ).rejects.toMatchObject({
      status: 413,
    });

    // Headerless oversized stream directly against the PUT upload route.
    let emitted = 0;
    const oneMb = new Uint8Array(1024 * 1024);
    const oversizedRouteStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted > 50) {
          controller.close();
          return;
        }
        emitted += 1;
        controller.enqueue(oneMb);
      },
    });
    const routeInit: RequestInit & { duplex: 'half' } = {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-asset-sha256': '0'.repeat(64),
      },
      body: oversizedRouteStream,
      duplex: 'half',
    };
    const oversizedRouteResp = await worker.fetch(
      new Request(
        'https://ota.usebaci.com/api/admin/assets/bundles/ios/stream-huge.hbc',
        routeInit
      ),
      env
    );
    expect(oversizedRouteResp.status).toBe(413);
  });

  it('rejects oversized publish body, excessive asset counts, oversized extra object, and external URL assets', async () => {
    const { env } = createEnv();
    const dummyB64 = createHash('sha256').update('x').digest('base64url');
    const baseAsset = {
      hash: dummyB64,
      key: 'x',
      contentType: 'application/javascript',
      r2Key: 'bundles/ios/a.hbc',
    };

    const externalUrlResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          platform: 'ios',
          runtimeVersion: RUNTIME,
          launchAsset: {
            hash: dummyB64,
            key: 'x',
            contentType: 'application/javascript',
            url: 'https://cdn.usebaci.com/a.hbc',
          },
        }),
      }),
      env
    );
    expect(externalUrlResp.status).toBe(400);

    const bigJsonResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          platform: 'ios',
          runtimeVersion: RUNTIME,
          launchAsset: baseAsset,
          extra: { blob: 'x'.repeat(520 * 1024) },
        }),
      }),
      env
    );
    expect(bigJsonResp.status).toBe(413);

    const manyAssets = Array.from(
      { length: MAX_MANIFEST_ASSETS + 1 },
      () => baseAsset
    );
    const tooManyAssetsResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          platform: 'ios',
          runtimeVersion: RUNTIME,
          launchAsset: baseAsset,
          assets: manyAssets,
        }),
      }),
      env
    );
    expect(tooManyAssetsResp.status).toBe(413);

    const bigExtraResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/admin/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          platform: 'ios',
          runtimeVersion: RUNTIME,
          launchAsset: baseAsset,
          extra: { big: 'e'.repeat(270 * 1024) },
        }),
      }),
      env
    );
    expect(bigExtraResp.status).toBe(413);
  });

  it('enforces monotonic publish createdAt and rejects stale or far-future timestamps', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T15:00:00.000Z'));
    try {
      const { env } = createEnv();
      const dummyBytes = new TextEncoder().encode('m');
      const dummyHex = createHash('sha256').update(dummyBytes).digest('hex');
      const dummyB64 = createHash('sha256')
        .update(dummyBytes)
        .digest('base64url');
      await worker.fetch(
        new Request(
          'https://ota.usebaci.com/api/admin/assets/bundles/ios/m.hbc',
          {
            method: 'PUT',
            headers: {
              authorization: `Bearer ${TOKEN}`,
              'content-type': 'application/javascript',
              'x-asset-sha256': dummyHex,
            },
            body: dummyBytes,
          }
        ),
        env
      );
      const baseAsset = {
        hash: dummyB64,
        key: dummyHex,
        contentType: 'application/javascript',
        r2Key: 'bundles/ios/m.hbc',
      };

      const farFuture = await worker.fetch(
        new Request('https://ota.usebaci.com/api/admin/publish', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            platform: 'ios',
            runtimeVersion: RUNTIME,
            updateId: '11111111-1111-4111-8111-111111111111',
            createdAt: '2026-11-25T15:10:00.000Z',
            launchAsset: baseAsset,
          }),
        }),
        env
      );
      expect(farFuture.status).toBe(400);

      // Publish with +2m future skew (allowed within 5m).
      const pub1 = await worker.fetch(
        new Request('https://ota.usebaci.com/api/admin/publish', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            platform: 'ios',
            runtimeVersion: RUNTIME,
            updateId: '11111111-1111-4111-8111-111111111111',
            createdAt: '2026-11-25T15:02:00.000Z',
            launchAsset: baseAsset,
          }),
        }),
        env
      );
      expect(pub1.status).toBe(200);

      // Older explicit createdAt for a new updateId must be rejected with 409.
      const staleExplicit = await worker.fetch(
        new Request('https://ota.usebaci.com/api/admin/publish', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            platform: 'ios',
            runtimeVersion: RUNTIME,
            updateId: '22222222-2222-4222-8222-222222222222',
            createdAt: '2026-11-25T15:01:00.000Z',
            launchAsset: baseAsset,
          }),
        }),
        env
      );
      expect(staleExplicit.status).toBe(409);

      // Publish without explicit createdAt clamps monotonically above 15:02:00.000Z.
      const pub2 = await worker.fetch(
        new Request('https://ota.usebaci.com/api/admin/publish', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            platform: 'ios',
            runtimeVersion: RUNTIME,
            updateId: '33333333-3333-4333-8333-333333333333',
            launchAsset: baseAsset,
          }),
        }),
        env
      );
      expect(pub2.status).toBe(200);

      const manifestResp = await worker.fetch(
        new Request('https://ota.usebaci.com/api/manifest', {
          headers: {
            'expo-protocol-version': '1',
            'expo-platform': 'ios',
            'expo-runtime-version': RUNTIME,
            'expo-channel-name': 'production',
          },
        }),
        env
      );
      const parts = parseMultipartMixed(
        manifestResp.headers.get('content-type'),
        await manifestResp.text()
      );
      const parsedManifest: unknown = JSON.parse(parts[0]?.body ?? '');
      if (
        typeof parsedManifest !== 'object' ||
        parsedManifest === null ||
        !('createdAt' in parsedManifest) ||
        typeof parsedManifest.createdAt !== 'string'
      ) {
        throw new Error(
          'Expected manifest response to include string createdAt'
        );
      }
      expect(Date.parse(parsedManifest.createdAt)).toBeGreaterThan(
        Date.parse('2026-11-25T15:02:00.000Z')
      );

      // Extreme future date beyond safe operational cap must be rejected at parse time.
      const maxDatePublish = await worker.fetch(
        new Request('https://ota.usebaci.com/api/admin/publish', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            platform: 'ios',
            runtimeVersion: RUNTIME,
            createdAt: '+275760-09-13T00:00:00.000Z',
            launchAsset: baseAsset,
          }),
        }),
        env
      );
      expect(maxDatePublish.status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });
});

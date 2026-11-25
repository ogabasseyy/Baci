import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { OtaWorkerEnv } from '../src/types';
import {
  MAX_ASSET_UPLOAD_BYTES,
  MAX_MANIFEST_ASSETS,
  readBodyBytesWithLimit,
} from '../src/validation';
import { MockR2Bucket } from './helpers/mock-r2';

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
    const streamedReq = new Request('https://ota.usebaci.com/upload', {
      method: 'PUT',
      body: stream,
      duplex: 'half',
    } as RequestInit);
    await expect(
      readBodyBytesWithLimit(streamedReq, 1024)
    ).rejects.toMatchObject({
      status: 413,
    });
  });

  it('rejects oversized publish body, excessive asset counts, and oversized extra object with 413', async () => {
    const { env } = createEnv();
    const dummyB64 = createHash('sha256').update('x').digest('base64url');
    const baseAsset = {
      hash: dummyB64,
      key: 'x',
      contentType: 'application/javascript',
      url: 'https://cdn.usebaci.com/a.hbc',
    };

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
});

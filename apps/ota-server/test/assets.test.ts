import { describe, expect, it } from 'vitest';
import { handleGetAsset } from '../src/assets-handler';
import worker from '../src/index';
import type { OtaWorkerEnv } from '../src/types';
import { MockR2Bucket } from './helpers/mock-r2';

function createEnv() {
  const bucket = new MockR2Bucket();
  const env: OtaWorkerEnv = {
    OTA_BUCKET: bucket,
    OTA_ADMIN_TOKEN: 'secret',
  };
  return { bucket, env };
}

describe('GET /api/assets/*', () => {
  it('serves immutable assets with proper headers and supports HEAD', async () => {
    const { bucket, env } = createEnv();
    await bucket.put('assets/blobs/abc123.png', new Uint8Array([1, 2, 3, 4]), {
      httpMetadata: { contentType: 'image/png' },
    });

    const getResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/assets/blobs/abc123.png'),
      env
    );
    expect(getResp.status).toBe(200);
    expect(getResp.headers.get('content-type')).toBe('image/png');
    expect(getResp.headers.get('content-length')).toBe('4');
    expect(getResp.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable'
    );
    expect(getResp.headers.get('x-content-type-options')).toBe('nosniff');
    expect(getResp.headers.get('etag')).toBeTruthy();
    expect(new Uint8Array(await getResp.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4])
    );

    const headResp = await worker.fetch(
      new Request('https://ota.usebaci.com/api/assets/blobs/abc123.png', {
        method: 'HEAD',
      }),
      env
    );
    expect(headResp.status).toBe(200);
    expect(headResp.headers.get('content-length')).toBe('4');
    expect(headResp.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable'
    );
    expect(await headResp.text()).toBe('');
  });

  it('returns 404 when asset does not exist and 405 on POST', async () => {
    const { env } = createEnv();
    const missing = await worker.fetch(
      new Request('https://ota.usebaci.com/api/assets/blobs/missing.png'),
      env
    );
    expect(missing.status).toBe(404);

    const post = await worker.fetch(
      new Request('https://ota.usebaci.com/api/assets/blobs/missing.png', {
        method: 'POST',
      }),
      env
    );
    expect(post.status).toBe(405);
  });

  it('strictly rejects path traversal and malformed asset paths', async () => {
    const { bucket, env } = createEnv();
    await bucket.put('channels/production/ios/1.0/current.json', '{"id":"1"}');

    const badPaths = [
      '/api/assets/',
      '/api/assets/../channels/production/ios/1.0/current.json',
      '/api/assets/blobs/../../channels/production/ios/1.0/current.json',
      '/api/assets/%2e%2e/channels/production/ios/1.0/current.json',
      '/api/assets/blobs/%2e%2e%2fsecret',
      '/api/assets/blobs\\secret',
      '/api/assets/blobs/%5csecret',
      '/api/assets/blobs/%00secret',
      '/api/assets/blobs//double.png',
      '/api/assets/blobs/trailing/',
      '/api/assets/./dot.png',
    ];

    for (const badPath of badPaths) {
      const directResp = await handleGetAsset(
        new Request(`https://ota.usebaci.com/api/assets/placeholder`),
        env,
        badPath
      );
      expect(directResp.status, `Expected 400 for ${badPath}`).toBe(400);
    }

    const encodedUrlResp = await worker.fetch(
      new Request(
        'https://ota.usebaci.com/api/assets/%2e%2e%2fchannels/current.json'
      ),
      env
    );
    expect(encodedUrlResp.status).toBe(400);
  });
});

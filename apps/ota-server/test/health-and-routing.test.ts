import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { OtaWorkerEnv } from '../src/types';
import { MockR2Bucket } from './helpers/mock-r2';

function createEnv(): OtaWorkerEnv {
  return {
    OTA_BUCKET: new MockR2Bucket(),
    OTA_ADMIN_TOKEN: 'test-admin-token',
  };
}

describe('health and routing', () => {
  it('returns healthy JSON on GET /health', async () => {
    const response = await worker.fetch(
      new Request('https://ota.usebaci.com/health'),
      createEnv()
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const json = (await response.json()) as {
      ok: boolean;
      service: string;
      status: string;
    };
    expect(json.ok).toBe(true);
    expect(json.service).toBe('baci-ota-server');
    expect(json.status).toBe('healthy');
  });

  it('rejects non-GET methods on /health', async () => {
    const response = await worker.fetch(
      new Request('https://ota.usebaci.com/health', { method: 'POST' }),
      createEnv()
    );
    expect(response.status).toBe(405);
  });

  it('returns 404 JSON on unknown routes', async () => {
    const response = await worker.fetch(
      new Request('https://ota.usebaci.com/unknown'),
      createEnv()
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('returns controlled 500 JSON with no-store on unexpected storage errors', async () => {
    const bucket = new MockR2Bucket();
    bucket.get = () => Promise.reject(new Error('sensitive-internal-r2-trace'));
    const env: OtaWorkerEnv = {
      OTA_BUCKET: bucket,
      OTA_ADMIN_TOKEN: 'test-admin-token',
    };
    const response = await worker.fetch(
      new Request('https://ota.usebaci.com/api/manifest', {
        headers: {
          'expo-protocol-version': '1',
          'expo-platform': 'ios',
          'expo-runtime-version': '2.1.663-ios-sdk58-rn0880-splashmotion1',
          'expo-channel-name': 'production',
        },
      }),
      env
    );
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Internal server error' });
  });
});

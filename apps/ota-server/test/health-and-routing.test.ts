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
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('PiggyVest staging preparation guard', () => {
  it.each([
    'production',
    'preview',
    'development',
  ])('blocks registration and event acknowledgement in %s', async (environment) => {
    vi.stubEnv('VERCEL_ENV', environment);
    vi.stubEnv('PVB_SECRET_KEY', 'synthetic-staging-secret');

    for (const handler of [GET, POST]) {
      const response = handler();

      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({
        error: 'Integration unavailable',
        code: 'PIGGYVEST_NOT_READY',
      });
    }
  });

  it('fails closed when no provider credentials are configured', () => {
    vi.stubEnv('PVB_SECRET_KEY', undefined);

    expect(GET().status).toBe(503);
    expect(POST().status).toBe(503);
  });
});

import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/address-budget/reservation', () => ({
  reserveAddressProviderRequest: vi.fn(async () => ({ status: 'unavailable' })),
}));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    eval() {
      throw new Error('synthetic Redis outage');
    }
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('does not admit unverified paid requests through a process-local development counter', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  for (const key of [
    'ADDRESS_AUTOCOMPLETE_KV_REST_API_URL',
    'ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN',
    'ADDRESS_AUTOCOMPLETE_REDIS_REST_URL',
    'ADDRESS_AUTOCOMPLETE_REDIS_REST_TOKEN',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
  ])
    vi.stubEnv(key, '');
  const { reserveGooglePlacesRequest } = await import('./provider-budget');
  expect(
    await reserveGooglePlacesRequest('autocomplete', 'synthetic-address-key')
  ).toEqual({
    reserved: false,
    reason: 'unavailable',
  });
});

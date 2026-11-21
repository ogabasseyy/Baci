import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  limit: vi.fn(),
  config: vi.fn(),
  redis: vi.fn(),
  readOrRefresh: vi.fn(),
  connect: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/rate-limit', () => ({
  checkOxygenProviderRateLimit: mocks.limit,
}));
vi.mock('@/lib/payments/oxygen/runtime-configuration', () => ({
  readOxygenRuntimeConfiguration: mocks.config,
}));
vi.mock('@/lib/redis', () => ({ getRedis: mocks.redis }));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: mocks.connect,
}));
vi.mock('@/lib/payments/oxygen/supported-bank-read-or-refresh', () => ({
  readOrRefreshSupportedBanks: mocks.readOrRefresh,
}));

import { GET, maxDuration } from './route';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'user' } });
  mocks.limit.mockResolvedValue({ allowed: true });
  mocks.config.mockReturnValue({
    environment: 'production',
    reference: 'partner',
  });
  mocks.redis.mockReturnValue({});
});

it('rejects unauthenticated reads', async () => {
  mocks.auth.mockResolvedValue({ user: null });

  expect((await GET(new Request('http://localhost'))).status).toBe(401);
  expect(mocks.readOrRefresh).not.toHaveBeenCalled();
});

it('rejects reads over the rate limit', async () => {
  mocks.limit.mockResolvedValue({ allowed: false });

  const response = await GET(new Request('http://localhost'));

  expect(response.status).toBe(429);
  expect(mocks.readOrRefresh).not.toHaveBeenCalled();
});

it('returns the environment-specific list for the authenticated customer', async () => {
  mocks.readOrRefresh.mockResolvedValue([{ name: 'Bank', code: '001' }]);

  const response = await GET(new Request('http://localhost'));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    banks: [{ name: 'Bank', code: '001' }],
  });
  expect(mocks.readOrRefresh).toHaveBeenCalledWith(
    expect.anything(),
    'production',
    'partner',
    expect.any(Function)
  );
  expect(mocks.limit).toHaveBeenCalledWith('user', 'supported-banks', 30);
});

it('offers the provider source only for the configured environment', async () => {
  mocks.readOrRefresh.mockResolvedValue([{ name: 'Bank', code: '001' }]);
  const provider = { environment: 'production' };
  mocks.connect.mockReturnValue({ provider });

  await GET(new Request('http://localhost'));
  const providerSource = mocks.readOrRefresh.mock.calls[0][3] as () => unknown;
  expect(providerSource()).toBe(provider);

  mocks.connect.mockReturnValue({ provider: { environment: 'staging' } });
  expect(providerSource()).toBeNull();
});

it('returns unavailable when the cache cannot be read or refreshed', async () => {
  mocks.readOrRefresh.mockResolvedValue(null);

  expect((await GET(new Request('http://localhost'))).status).toBe(503);
});

it('includes a retry interval on rate-limited requests', async () => {
  mocks.limit.mockResolvedValue({
    allowed: false,
    resetTime: Date.now() + 30000,
  });
  const response = await GET(new Request('http://localhost'));
  expect(response.status).toBe(429);
  expect(response.headers.get('X-Oxygen-Rate-Limit-Scope')).toBe('user');
  expect(response.headers.get('X-Oxygen-Rate-Limit-User')).toBe('user');
  expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect(mocks.readOrRefresh).not.toHaveBeenCalled();
});

it('allows time for a cold partner login plus a bank-list request', () => {
  // Each provider call may need its own 30s; keep the sibling routes' headroom.
  const providerBudgetSeconds = 2 * 30;
  expect(maxDuration).toBeGreaterThanOrEqual(providerBudgetSeconds + 60);
});

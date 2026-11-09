import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  limit: vi.fn(),
  config: vi.fn(),
  redis: vi.fn(),
  read: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/rate-limit', () => ({
  checkOxygenProviderRateLimit: mocks.limit,
}));
vi.mock('@/lib/payments/oxygen/runtime-configuration', () => ({
  readOxygenRuntimeConfiguration: mocks.config,
}));
vi.mock('@/lib/redis', () => ({ getRedis: mocks.redis }));
vi.mock('@/lib/payments/oxygen/supported-bank-cache', () => ({
  readSupportedBanks: mocks.read,
}));

import { GET } from './route';

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
  expect(mocks.read).not.toHaveBeenCalled();
});
it('returns the environment-specific cached list without a provider request', async () => {
  mocks.read.mockResolvedValue([{ name: 'Bank', code: '001' }]);
  const response = await GET(new Request('http://localhost'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    banks: [{ name: 'Bank', code: '001' }],
  });
  expect(mocks.read).toHaveBeenCalledWith(
    expect.anything(),
    'production',
    'partner'
  );
});
it('returns unavailable when no saved list exists', async () => {
  mocks.read.mockResolvedValue(null);
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
  expect(mocks.read).not.toHaveBeenCalled();
});

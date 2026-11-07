import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  valid: vi.fn(),
  config: vi.fn(),
  connect: vi.fn(),
  redis: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/lib/cron-secret-auth', () => ({ hasValidCronSecret: mocks.valid }));
vi.mock('@/lib/payments/oxygen/runtime-configuration', () => ({
  readOxygenRuntimeConfiguration: mocks.config,
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: mocks.connect,
}));
vi.mock('@/lib/payments/oxygen/supported-bank-cache', () => ({
  refreshSupportedBanks: mocks.refresh,
}));
vi.mock('@/lib/redis', () => ({ getRedis: mocks.redis }));

import { GET } from './route';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.valid.mockReturnValue(true);
  mocks.config.mockReturnValue({
    environment: 'production',
    reference: 'partner',
  });
  mocks.connect.mockReturnValue({ provider: { environment: 'production' } });
  mocks.redis.mockReturnValue({});
  mocks.refresh.mockResolvedValue([{ name: 'Bank', code: '001' }]);
});
it('rejects a request without the cron secret', async () => {
  mocks.valid.mockReturnValue(false);
  expect((await GET(new Request('http://localhost'))).status).toBe(401);
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it('refreshes only the configured provider environment', async () => {
  const response = await GET(new Request('http://localhost'));
  expect(response.status).toBe(200);
  expect(mocks.refresh).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    'production',
    'partner'
  );
});
it('refuses environment mismatch', async () => {
  mocks.connect.mockReturnValue({ provider: { environment: 'staging' } });
  expect((await GET(new Request('http://localhost'))).status).toBe(503);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

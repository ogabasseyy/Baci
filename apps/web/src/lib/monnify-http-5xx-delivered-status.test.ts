import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/monnify', () => ({
  getMonnifyToken: vi.fn().mockResolvedValue('mock-token'),
}));
vi.mock('@/lib/monnify-provider-config', () => ({
  getMonnifyBaseUrl: () => 'https://sandbox.monnify.com',
}));

import { purchaseBill } from './monnify-bills';

const vend = () =>
  purchaseBill(
    'MTN',
    '13',
    '08012345678',
    100,
    'JANE DOE',
    'a1b2c3d4e5f6a1b2c3d4e5f6'
  );

function mockHttpError(status: number, body: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: 'Error',
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bugfix: an HTTP 5xx body that says the vend was delivered or is running is held', () => {
  it.each([
    'SUCCESS',
    'COMPLETED',
    'PENDING',
    'PROCESSING',
    'UNKNOWN',
  ])('holds an HTTP 500 with vendStatus %s', async (vendStatus) => {
    mockHttpError(500, { responseBody: { vendStatus } });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });

  it('still throws a retryable error for a plain HTTP 500', async () => {
    mockHttpError(500, { responseMessage: 'Upstream error' });

    await expect(vend()).rejects.toMatchObject({
      name: 'MonnifyTransientVendError',
    });
  });
});

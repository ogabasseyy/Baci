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

function mockJson(json: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(json),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bugfix: a code written into a refusal message is not a definite refusal', () => {
  it('does not mark "Insufficient wallet balance; response code 99" as definite failure', async () => {
    mockJson({
      requestSuccessful: false,
      responseCode: '01',
      responseMessage: 'Insufficient wallet balance; response code 99',
    });

    const result = await vend();

    expect(result.providerDefiniteFailure).not.toBe(true);
  });

  it('still marks plain low-float wording as a definite refusal', async () => {
    mockJson({
      requestSuccessful: false,
      responseCode: '01',
      responseMessage: 'Insufficient wallet balance',
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'failed',
      providerDefiniteFailure: true,
    });
  });
});

describe('bugfix: a plainly DECLINED fresh vend is refunded, not held forever', () => {
  it('fails a vendStatus DECLINED with no token or reference', async () => {
    mockJson({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: { vendStatus: 'DECLINED' },
    });

    const result = await vend();

    expect(result.status).toBe('failed');
    expect(result.providerOutcomeUnresolved).not.toBe(true);
    expect(result.providerDefiniteFailure).not.toBe(true);
  });

  it('still holds DECLINED that carries a Monnify vend reference', async () => {
    mockJson({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: { vendStatus: 'DECLINED', vendReference: 'MFBP-1' },
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });

  it('still holds REVERSED', async () => {
    mockJson({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: { vendStatus: 'REVERSED' },
    });

    await expect(vend()).resolves.toMatchObject({
      providerOutcomeUnresolved: true,
    });
  });
});

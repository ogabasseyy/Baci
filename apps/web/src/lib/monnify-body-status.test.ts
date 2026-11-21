import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/monnify', () => ({
  getMonnifyToken: vi.fn().mockResolvedValue('mock-token'),
}));
vi.mock('@/lib/monnify-provider-config', () => ({
  getMonnifyBaseUrl: () => 'https://sandbox.monnify.com',
}));

import { purchaseBill } from './monnify-bills';
import { isMonnifyRequeryRejectionDefiniteFailure } from './monnify-requery-rejection';
import { hasMonnifyExplicitVendFailure } from './monnify-unresolved-answer';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bugfix: a conflicting reference-less vend is held, not retried', () => {
  it('holds vendStatus SUCCESS with transactionStatus FAILED and no references or token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: true,
        responseCode: '0',
        responseMessage: 'success',
        responseBody: { vendStatus: 'SUCCESS', transactionStatus: 'FAILED' },
      }),
    });

    await expect(
      purchaseBill('MTN', '13', '08012345678', 100, 'JANE DOE', 'BACI-REF-1')
    ).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });
});

describe('bugfix: a FAILED status inside the result body is the vend outcome', () => {
  it('proves failure for a rejected requery with a neutral message', () => {
    expect(
      isMonnifyRequeryRejectionDefiniteFailure({
        envelope: { responseBody: { status: 'FAILED' } },
        rawMessage: 'Could not complete',
      })
    ).toBe(true);
  });

  it('still ignores a generic top-level status FAILED', () => {
    expect(hasMonnifyExplicitVendFailure({ status: 'FAILED' })).toBe(false);
  });

  it('does not override a vend-specific state that disagrees', () => {
    expect(
      hasMonnifyExplicitVendFailure({
        responseBody: { status: 'FAILED', vendStatus: 'COMPLETED' },
      })
    ).toBe(false);
    expect(
      hasMonnifyExplicitVendFailure({
        responseBody: { status: 'FAILED', vendStatus: 'PENDING' },
      })
    ).toBe(false);
  });
});

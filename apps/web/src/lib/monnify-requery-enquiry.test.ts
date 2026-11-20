import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/monnify', () => ({
  getMonnifyToken: vi.fn().mockResolvedValue('mock-token'),
}));
vi.mock('@/lib/monnify-provider-config', () => ({
  getMonnifyBaseUrl: () => 'https://sandbox.monnify.com',
}));

import { checkTransactionStatus, purchaseBill } from './monnify-bills';
import { isMonnifyRequeryRejectionDefiniteFailure } from './monnify-requery-rejection';

beforeEach(() => {
  vi.clearAllMocks();
});

const check = (rawMessage: string, envelope: unknown = {}) =>
  isMonnifyRequeryRejectionDefiniteFailure({ envelope, rawMessage });

describe('bugfix: enquiry, inquiry and fetch failures describe the query, not the vend', () => {
  it.each([
    'Transaction enquiry failed',
    'Transaction inquiry failed',
    'Transaction fetch failed',
    'Transaction retrieval failed',
  ])('keeps "%s" unresolved', (message) => {
    expect(check(message)).toBe(false);
  });

  it('still accepts a vend failure when a callback is merely mentioned', () => {
    expect(check('Vend failed; callback notification sent')).toBe(true);
  });

  it.each([
    'Transaction reversal failed',
    'Refund failed',
    'Failed to process refund',
  ])('keeps the ancillary failure "%s" unresolved', (message) => {
    expect(check(message)).toBe(false);
  });
});

function mockBody(responseBody: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody,
    }),
  });
}

describe('bugfix: transactionStatus is read as the vend state on a requery', () => {
  it('returns failed for transactionStatus FAILED', async () => {
    mockBody({ transactionReference: 'MON-TX-1', transactionStatus: 'FAILED' });

    await expect(checkTransactionStatus('MFBP-1')).resolves.toMatchObject({
      status: 'failed',
    });
  });

  it('returns successful for transactionStatus SUCCESS', async () => {
    mockBody({
      transactionReference: 'MON-TX-1',
      transactionStatus: 'SUCCESS',
    });

    await expect(checkTransactionStatus('MFBP-1')).resolves.toMatchObject({
      status: 'successful',
    });
  });

  it('accepts a numeric transactionStatus without throwing and stays unknown', async () => {
    mockBody({ transactionReference: 'MON-TX-1', transactionStatus: 2 });

    await expect(checkTransactionStatus('MFBP-1')).resolves.toMatchObject({
      status: 'unknown',
    });
  });
});

describe('bugfix: a pending vend never carries a voucher pin', () => {
  it('drops the token on a PENDING vend so the row can still settle and notify', async () => {
    mockBody({
      transactionReference: 'MNFY-1',
      vendReference: 'MFBP-1',
      vendStatus: 'PENDING',
      metaData: { token: '1111-2222-3333' },
    });

    const result = await purchaseBill(
      'MTN',
      '13',
      '08012345678',
      100,
      'JANE DOE',
      'BACI-REF-123'
    );

    expect(result).toMatchObject({
      status: 'pending',
      providerVendReference: 'MFBP-1',
    });
    expect(result.pin).toBeUndefined();
  });
});

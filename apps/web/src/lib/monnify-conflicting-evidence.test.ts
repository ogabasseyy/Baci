import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/monnify', () => ({
  getMonnifyToken: vi.fn().mockResolvedValue('mock-token'),
}));
vi.mock('@/lib/monnify-provider-config', () => ({
  getMonnifyBaseUrl: () => 'https://sandbox.monnify.com',
}));

import { checkTransactionStatus, purchaseBill } from './monnify-bills';
import { hasConflictingVendStatuses } from './monnify-bills-status';
import { hasMonnifyUnresolvedCode } from './monnify-non-definitive-code';
import { isMonnifyRequeryRejectionDefiniteFailure } from './monnify-requery-rejection';
import { hasMonnifyExplicitVendFailure } from './monnify-unresolved-answer';

beforeEach(() => {
  vi.clearAllMocks();
});

function mockEnvelope(envelope: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(envelope),
  });
}

const vend = () =>
  purchaseBill('MTN', '13', '08012345678', 100, 'JANE DOE', 'BACI-REF-123');

describe('hasConflictingVendStatuses', () => {
  it('is true when one says success and the other failed', () => {
    expect(
      hasConflictingVendStatuses({
        vendStatus: 'FAILED',
        transactionStatus: 'SUCCESS',
      })
    ).toBe(true);
    expect(
      hasConflictingVendStatuses({
        vendStatus: 'SUCCESS',
        transactionStatus: 'FAILED',
      })
    ).toBe(true);
  });

  it.each([
    [{ vendStatus: 'SUCCESS', transactionStatus: 'SUCCESS' }],
    [{ vendStatus: 'FAILED' }],
    [{ transactionStatus: 'FAILED' }],
  ])('is false for %j', (body) => {
    expect(hasConflictingVendStatuses(body)).toBe(false);
  });
});

describe('bugfix: conflicting vend and transaction statuses are held, not settled or refunded', () => {
  const body = {
    transactionReference: 'MNFY-1',
    vendReference: 'MFBP-1',
    vendStatus: 'FAILED',
    transactionStatus: 'SUCCESS',
  };

  it('holds a fresh vend', async () => {
    mockEnvelope({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: body,
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
      providerVendReference: 'MFBP-1',
    });
  });

  it('returns unknown on a requery', async () => {
    mockEnvelope({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: body,
    });

    await expect(checkTransactionStatus('MFBP-1')).resolves.toMatchObject({
      status: 'unknown',
    });
  });
});

describe('bugfix: a business 401/403/429 code is refunded even with a vend status', () => {
  it.each([
    '401',
    '403',
    '429',
  ])('refunds code %s with vendStatus PENDING', async (code) => {
    mockEnvelope({
      requestSuccessful: false,
      responseCode: code,
      responseMessage: 'Rejected',
      responseBody: { vendStatus: 'PENDING' },
    });

    await expect(vend()).resolves.toMatchObject({ status: 'failed' });
  });
});

describe('bugfix: nested catalog codes are not response codes', () => {
  it.each([
    'product',
    'biller',
    'item',
  ])('ignores %s.code 200/500', (parent) => {
    expect(
      hasMonnifyUnresolvedCode({
        responseCode: '01',
        responseBody: { [parent]: { code: '500' } },
      })
    ).toBe(false);
  });

  it('still reads a real nested responseCode', () => {
    expect(
      hasMonnifyUnresolvedCode({ responseBody: { responseCode: '99' } })
    ).toBe(true);
  });
});

describe('bugfix: ancillary verb forms and generic failed flags', () => {
  it.each([
    'Transaction failed to reverse',
    'Payment failed to settle',
  ])('keeps "%s" unresolved', (message) => {
    expect(
      isMonnifyRequeryRejectionDefiniteFailure({
        envelope: {},
        rawMessage: message,
      })
    ).toBe(false);
  });

  it('still accepts "Vend failed and was reversed"', () => {
    expect(
      isMonnifyRequeryRejectionDefiniteFailure({
        envelope: {},
        rawMessage: 'Vend failed and was reversed',
      })
    ).toBe(true);
  });

  it('does not treat a top-level failed: true as proof of vend failure', () => {
    expect(hasMonnifyExplicitVendFailure({ failed: true })).toBe(false);
  });

  it('treats failed: true inside responseBody as proof', () => {
    expect(
      hasMonnifyExplicitVendFailure({ responseBody: { failed: true } })
    ).toBe(true);
  });
});

describe('bugfix: FAILED beside a pending or unknown vend state is held', () => {
  it.each([
    [{ vendStatus: 'FAILED', transactionStatus: 'PENDING' }],
    [{ vendStatus: 'FAILED', transactionStatus: 'UNKNOWN' }],
    [{ vendStatus: 'FAILED', finalStatus: 'SUCCESS' }],
  ])('treats %j as a conflict', (body) => {
    expect(hasConflictingVendStatuses(body)).toBe(true);
  });

  it('holds a fresh vend with vendStatus FAILED and transactionStatus PENDING', async () => {
    mockEnvelope({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: {
        transactionReference: 'MNFY-1',
        vendReference: 'MFBP-1',
        vendStatus: 'FAILED',
        transactionStatus: 'PENDING',
      },
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });
});

describe('bugfix: finalStatus is read from a success envelope', () => {
  it('does not settle a payment SUCCESS whose finalStatus is PENDING', async () => {
    mockEnvelope({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: {
        transactionReference: 'MNFY-1',
        vendReference: 'MFBP-1',
        status: 'SUCCESS',
        finalStatus: 'PENDING',
      },
    });

    await expect(vend()).resolves.toMatchObject({ status: 'pending' });
  });

  it('reads finalStatus FAILED on a requery', async () => {
    mockEnvelope({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: { transactionReference: 'MNFY-1', finalStatus: 'FAILED' },
    });

    await expect(checkTransactionStatus('MFBP-1')).resolves.toMatchObject({
      status: 'failed',
    });
  });
});

describe('bugfix: customer and product statuses never prove a vend failed', () => {
  it.each([
    'customerStatus',
    'productStatus',
    'billerStatus',
    'accountStatus',
  ])('ignores %s: FAILED', (key) => {
    expect(
      hasMonnifyExplicitVendFailure({ responseBody: { [key]: 'FAILED' } })
    ).toBe(false);
  });

  it('still accepts vendStatus and finalStatus FAILED', () => {
    expect(
      hasMonnifyExplicitVendFailure({ responseBody: { vendStatus: 'FAILED' } })
    ).toBe(true);
    expect(
      hasMonnifyExplicitVendFailure({ responseBody: { finalStatus: 'FAILED' } })
    ).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/monnify', () => ({
  getMonnifyToken: vi.fn().mockResolvedValue('mock-token'),
}));
vi.mock('@/lib/monnify-provider-config', () => ({
  getMonnifyBaseUrl: () => 'https://sandbox.monnify.com',
}));

import { checkTransactionStatus, purchaseBill } from './monnify-bills';
import { readMonnifyBillToken } from './monnify-bills-status';
import { isMonnifyRequeryRejectionDefiniteFailure } from './monnify-requery-rejection';
import { hasMonnifyExplicitVendFailure } from './monnify-unresolved-answer';

beforeEach(() => {
  vi.clearAllMocks();
});

function mockJson(json: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(json),
  });
}

describe('bugfix: every status beneath a non-vend ancestor is excluded', () => {
  it('ignores refund.details.transactionStatus FAILED', () => {
    expect(
      hasMonnifyExplicitVendFailure({
        responseBody: {
          refund: { details: { transactionStatus: 'FAILED' } },
        },
      })
    ).toBe(false);
  });

  it('still accepts a top-level vendStatus FAILED', () => {
    expect(
      hasMonnifyExplicitVendFailure({ responseBody: { vendStatus: 'FAILED' } })
    ).toBe(true);
  });
});

describe('bugfix: evidence-denial wording is not proof of failure', () => {
  it.each([
    'No evidence that transaction failed',
    'Unable to establish that the vend failed',
    'Failure cannot be determined',
    'Without confirmation the purchase failed',
  ])('keeps "%s" unresolved', (message) => {
    expect(
      isMonnifyRequeryRejectionDefiniteFailure({
        envelope: {},
        rawMessage: message,
      })
    ).toBe(false);
  });
});

describe('bugfix: a FAILED vend with a token records that a token was seen', () => {
  it('flags providerTokenSeen on the contradictory hold', async () => {
    mockJson({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: {
        transactionReference: 'MNFY-1',
        vendStatus: 'FAILED',
        metaData: { token: '1111-2222-3333' },
      },
    });

    const result = await purchaseBill(
      'MTN',
      '13',
      '08012345678',
      100,
      'JANE DOE',
      'BACI-REF-1'
    );

    expect(result).toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
      providerTokenSeen: true,
    });
    expect(result.pin).toBeUndefined();
  });
});

describe('bugfix: a business 401/403/429 requery proves nothing even with FAILED', () => {
  it.each([
    '401',
    '403',
    '429',
  ])('returns unknown for code %s', async (code) => {
    mockJson({
      requestSuccessful: false,
      responseCode: code,
      responseMessage: 'Rejected',
      responseBody: { vendStatus: 'FAILED' },
    });

    await expect(checkTransactionStatus('MFBP-1')).resolves.toMatchObject({
      status: 'unknown',
    });
  });

  it('returns unknown for login wording with another code', async () => {
    mockJson({
      requestSuccessful: false,
      responseCode: 'D01',
      responseMessage: 'Invalid access token',
      responseBody: { vendStatus: 'FAILED' },
    });

    await expect(checkTransactionStatus('MFBP-1')).resolves.toMatchObject({
      status: 'unknown',
    });
  });

  it('still returns failed for an explicit FAILED with a neutral code', async () => {
    mockJson({
      requestSuccessful: false,
      responseCode: 'D02',
      responseMessage: 'Could not complete',
      responseBody: { vendStatus: 'FAILED' },
    });

    await expect(checkTransactionStatus('MFBP-1')).resolves.toMatchObject({
      status: 'failed',
    });
  });
});

describe('bugfix: separator-spaced placeholder tokens are not a token', () => {
  it.each([
    'N / A',
    '-- pending --',
    'N.A.',
    '_ null _',
    '* TBD *',
  ])('ignores %j', (token) => {
    expect(readMonnifyBillToken({ token })).toBeUndefined();
  });

  it('keeps real tokens', () => {
    expect(readMonnifyBillToken({ token: '3772-0340-4164' })).toBe(
      '3772-0340-4164'
    );
    expect(readMonnifyBillToken({ token: 'TEST-1234-5678' })).toBe(
      'TEST-1234-5678'
    );
  });
});

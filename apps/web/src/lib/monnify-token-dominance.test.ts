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

const vend = () =>
  purchaseBill('MTN', '13', '08012345678', 100, 'JANE DOE', 'BACI-REF-1');

function mockJson(json: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(json),
  });
}

function mockHttpError(status: number, body: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: 'Error',
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

describe('bugfix: a voucher token dominates an auth or throttle code', () => {
  it.each([
    '401',
    '403',
    '429',
  ])('holds a business code %s that carries a token', async (code) => {
    mockJson({
      requestSuccessful: false,
      responseCode: code,
      responseMessage: 'Unauthorized',
      responseBody: { token: '1111-2222-3333' },
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });

  it.each([
    401, 403, 429,
  ])('holds an HTTP %i that carries a token', async (status) => {
    mockHttpError(status, {
      responseMessage: 'Unauthorized',
      responseBody: { token: '1111-2222-3333' },
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });

  it('still refunds a 401 with no token (owner decision 2026-11-18)', async () => {
    mockHttpError(401, { responseMessage: 'Unauthorized' });

    await expect(vend()).resolves.toMatchObject({ status: 'failed' });
  });

  it('still refunds a business code 403 with a vend status but no token', async () => {
    mockJson({
      requestSuccessful: false,
      responseCode: '403',
      responseMessage: 'Forbidden',
      responseBody: { vendStatus: 'PENDING' },
    });

    await expect(vend()).resolves.toMatchObject({ status: 'failed' });
  });
});

describe('bugfix: ancillary object states do not prove the vend failed', () => {
  it.each([
    'refund',
    'reversal',
    'settlement',
    'callback',
  ])('ignores %s.status FAILED', (parent) => {
    expect(
      isMonnifyRequeryRejectionDefiniteFailure({
        envelope: { responseBody: { [parent]: { status: 'FAILED' } } },
        rawMessage: 'Could not complete',
      })
    ).toBe(false);
  });
});

describe('bugfix: a numeric vendStatus is parsed and held, not thrown', () => {
  it('holds a fresh vend whose vendStatus is a number', async () => {
    mockJson({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: {
        transactionReference: 'MNFY-1',
        vendReference: 'MFBP-1',
        vendStatus: 2,
      },
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });

  it('stays unknown on a requery with a numeric vendStatus', async () => {
    mockJson({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: { transactionReference: 'MNFY-1', vendStatus: 2 },
    });

    await expect(checkTransactionStatus('MFBP-1')).resolves.toMatchObject({
      status: 'unknown',
    });
  });
});

describe('bugfix: flattened ancillary statuses and hedged wording', () => {
  it.each([
    'refundStatus',
    'reversalStatus',
    'settlementStatus',
    'callbackStatus',
  ])('does not treat %s FAILED as proof the vend failed', (key) => {
    expect(
      isMonnifyRequeryRejectionDefiniteFailure({
        envelope: { responseBody: { [key]: 'FAILED' } },
        rawMessage: 'Could not complete',
      })
    ).toBe(false);
  });

  it.each([
    'Transaction may have failed',
    'Vend might have failed',
    'Transaction could have failed',
    'Purchase possibly failed',
    'The vend appears to have failed',
  ])('keeps the hedged "%s" unresolved', (message) => {
    expect(
      isMonnifyRequeryRejectionDefiniteFailure({
        envelope: {},
        rawMessage: message,
      })
    ).toBe(false);
  });

  it('still accepts a plain "Vend failed"', () => {
    expect(
      isMonnifyRequeryRejectionDefiniteFailure({
        envelope: {},
        rawMessage: 'Vend failed',
      })
    ).toBe(true);
  });
});

describe('bugfix: a held answer that carried a token says so', () => {
  it('flags providerTokenSeen on a pending-with-token hold, without a pin', async () => {
    mockJson({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: {
        transactionReference: 'MNFY-1',
        vendStatus: 'PENDING',
        metaData: { token: '1111-2222-3333' },
      },
    });

    const result = await vend();

    expect(result).toMatchObject({
      status: 'pending',
      providerTokenSeen: true,
    });
    expect(result.pin).toBeUndefined();
  });

  it('flags providerTokenSeen on a token beside a 401', async () => {
    mockHttpError(401, {
      responseMessage: 'Unauthorized',
      responseBody: { token: '1111-2222-3333' },
    });

    await expect(vend()).resolves.toMatchObject({ providerTokenSeen: true });
  });

  it('does not flag a hold with no token', async () => {
    mockJson({
      requestSuccessful: false,
      responseCode: '99',
      responseMessage: 'Please re-query',
    });

    const result = await vend();

    expect(result.providerTokenSeen).toBeUndefined();
  });
});

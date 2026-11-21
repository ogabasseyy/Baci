import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/monnify', () => ({
  getMonnifyToken: vi.fn().mockResolvedValue('mock-token'),
}));
vi.mock('@/lib/monnify-provider-config', () => ({
  getMonnifyBaseUrl: () => 'https://sandbox.monnify.com',
}));

import { joinMonnifyAnswerStrings } from './monnify-answer-strings';
import { checkTransactionStatus, purchaseBill } from './monnify-bills';
import { readMonnifyBillToken } from './monnify-bills-status';
import { hasMonnifyAuthOrThrottleCode } from './monnify-non-definitive-code';
import { hasMonnifyProviderReference } from './monnify-rejection-vend-reference';
import { isMonnifyRequeryRejectionDefiniteFailure } from './monnify-requery-rejection';

const REQ = 'a1b2c3d4e5f6a1b2c3d4e5f6';
const vend = () =>
  purchaseBill('MTN', '13', '08012345678', 100, 'JANE DOE', REQ);

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe('bugfix: ancestry reaches the joined wording and every reference key', () => {
  it('skips a status nested under refund/request in the joined wording', () => {
    expect(
      joinMonnifyAnswerStrings({
        responseMessage: 'Invalid customer',
        responseBody: { refund: { details: { status: 'PENDING' } } },
      })
    ).toBe('Invalid customer');
  });

  it('refunds a purchase rejection with refund.details.status PENDING', async () => {
    mockJson({
      requestSuccessful: false,
      responseCode: '01',
      responseMessage: 'Invalid customer',
      responseBody: { refund: { details: { status: 'PENDING' } } },
    });

    await expect(vend()).resolves.toMatchObject({ status: 'failed' });
  });

  it('ignores refund.details.transactionReference', () => {
    expect(
      hasMonnifyProviderReference(
        {
          responseBody: {
            refund: { details: { transactionReference: 'REFUND-TXN-1' } },
          },
        },
        REQ
      )
    ).toBe(false);
  });
});

describe('bugfix: a token is recorded on conflicting-status holds', () => {
  it('flags providerTokenSeen when SUCCESS and FAILED statuses carry a token', async () => {
    mockJson({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: {
        transactionReference: 'MNFY-1',
        vendStatus: 'SUCCESS',
        transactionStatus: 'FAILED',
        metaData: { token: '1111-2222-3333' },
      },
    });

    const result = await vend();

    expect(result).toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
      providerTokenSeen: true,
    });
    expect(result.pin).toBeUndefined();
  });
});

describe('bugfix: an HTTP 5xx that carries a token is held, not retried', () => {
  it('holds an HTTP 500 vend with a token and flags it', async () => {
    mockHttpError(500, {
      responseMessage: 'Upstream error',
      responseBody: { token: '1111-2222-3333' },
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
      providerTokenSeen: true,
    });
  });

  it('still throws a retryable error for an HTTP 500 with no token', async () => {
    mockHttpError(500, { responseMessage: 'Upstream error' });

    await expect(vend()).rejects.toMatchObject({
      name: 'MonnifyTransientVendError',
    });
  });
});

describe('bugfix: phrase-shaped placeholder tokens are not a token', () => {
  it.each([
    'NOT AVAILABLE',
    'NO TOKEN',
    'Not Applicable',
    'not-issued',
  ])('ignores %j', (token) => {
    expect(readMonnifyBillToken({ token })).toBeUndefined();
  });

  it('keeps a real token', () => {
    expect(readMonnifyBillToken({ token: '3772-0340-4164' })).toBe(
      '3772-0340-4164'
    );
  });
});

describe('bugfix: nested auth and throttle codes prove nothing', () => {
  it('finds a nested 401 in statusCode', () => {
    expect(
      hasMonnifyAuthOrThrottleCode({
        responseBody: { statusCode: 401, vendStatus: 'FAILED' },
      })
    ).toBe(true);
  });

  it('does not flag an ordinary body', () => {
    expect(
      hasMonnifyAuthOrThrottleCode({ responseCode: '01', responseBody: {} })
    ).toBe(false);
  });

  it('returns unknown for a business requery with a nested 401 and FAILED', async () => {
    mockJson({
      requestSuccessful: false,
      responseCode: 'D02',
      responseMessage: 'Could not complete',
      responseBody: { statusCode: 401, vendStatus: 'FAILED' },
    });

    await expect(checkTransactionStatus('MFBP-1')).resolves.toMatchObject({
      status: 'unknown',
    });
  });

  it('rethrows an HTTP 400 requery with a nested 403 and FAILED', async () => {
    mockHttpError(400, {
      responseCode: 'D02',
      responseMessage: 'Could not complete',
      responseBody: { statusCode: 403, vendStatus: 'FAILED' },
    });

    await expect(checkTransactionStatus('MFBP-1')).rejects.toBeDefined();
  });

  it('refunds a fresh vend with a nested 401 and a PENDING echo', async () => {
    mockJson({
      requestSuccessful: false,
      responseCode: 'D01',
      responseMessage: 'Rejected',
      responseBody: { statusCode: 401, vendStatus: 'PENDING' },
    });

    await expect(vend()).resolves.toMatchObject({ status: 'failed' });
  });
});

describe('bugfix: postpositive uncertainty is not proof of failure', () => {
  it.each([
    'Transaction failure is possible',
    'Transaction failed, although that is unlikely',
    'Vend failed but this is uncertain',
  ])('keeps "%s" unresolved', (message) => {
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

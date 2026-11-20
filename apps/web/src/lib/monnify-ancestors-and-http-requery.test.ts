import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/monnify', () => ({
  getMonnifyToken: vi.fn().mockResolvedValue('mock-token'),
}));
vi.mock('@/lib/monnify-provider-config', () => ({
  getMonnifyBaseUrl: () => 'https://sandbox.monnify.com',
}));

import { checkTransactionStatus, purchaseBill } from './monnify-bills';
import { classifyMonnifyBillStatus } from './monnify-bills-status';
import { isMonnifyDuplicateReferenceText } from './monnify-duplicate-reference';
import { hasMonnifyProviderReference } from './monnify-rejection-vend-reference';
import { hasMonnifyExplicitVendFailure } from './monnify-unresolved-answer';

beforeEach(() => {
  vi.clearAllMocks();
});

const REQ = 'a1b2c3d4e5f6a1b2c3d4e5f6';
const vend = () =>
  purchaseBill('MTN', '13', '08012345678', 100, 'JANE DOE', REQ);

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

describe('bugfix: an excluded ancestor excludes its whole subtree', () => {
  it('ignores request.details.status FAILED', () => {
    expect(
      hasMonnifyExplicitVendFailure({
        responseBody: { request: { details: { status: 'FAILED' } } },
      })
    ).toBe(false);
  });

  it('ignores refund.meta.reference', () => {
    expect(
      hasMonnifyProviderReference(
        { responseBody: { refund: { meta: { reference: 'R-1' } } } },
        REQ
      )
    ).toBe(false);
  });
});

describe('bugfix: authentication wording is refunded whatever the code', () => {
  it('refunds a business D01 "Invalid access token" with a PENDING echo', async () => {
    mockJson({
      requestSuccessful: false,
      responseCode: 'D01',
      responseMessage: 'Invalid access token',
      responseBody: { vendStatus: 'PENDING' },
    });

    await expect(vend()).resolves.toMatchObject({ status: 'failed' });
  });

  it('refunds an HTTP 400 "Invalid access token" with a PENDING echo', async () => {
    mockHttpError(400, {
      responseCode: 'D01',
      responseMessage: 'Invalid access token',
      responseBody: { vendStatus: 'PENDING' },
    });

    await expect(vend()).resolves.toMatchObject({ status: 'failed' });
  });
});

describe('bugfix: an HTTP 4xx requery body that names the vend FAILED is proof', () => {
  it('returns failed for HTTP 400 with vendStatus FAILED', async () => {
    mockHttpError(400, {
      responseCode: 'D02',
      responseMessage: 'Could not complete',
      responseBody: { vendStatus: 'FAILED' },
    });

    await expect(checkTransactionStatus('MFBP-1')).resolves.toMatchObject({
      status: 'failed',
      responseCode: 'D02',
    });
  });

  it.each([
    401, 403, 429,
  ])('rethrows HTTP %i even with vendStatus FAILED', async (status) => {
    mockHttpError(status, { responseBody: { vendStatus: 'FAILED' } });

    await expect(checkTransactionStatus('MFBP-1')).rejects.toBeDefined();
  });

  it('rethrows an HTTP 400 requery with no vend failure', async () => {
    mockHttpError(400, { responseMessage: 'Bad request' });

    await expect(checkTransactionStatus('MFBP-1')).rejects.toBeDefined();
  });
});

describe('bugfix: COMPLETED is a successful vend state', () => {
  it('classifies finalStatus COMPLETED as success', () => {
    expect(
      classifyMonnifyBillStatus({ vendStatus: 'COMPLETED' }).isSuccess
    ).toBe(true);
  });

  it('settles a payment SUCCESS whose finalStatus is COMPLETED', async () => {
    mockJson({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: {
        transactionReference: 'MNFY-1',
        vendReference: 'MFBP-1',
        status: 'SUCCESS',
        finalStatus: 'COMPLETED',
      },
    });

    await expect(vend()).resolves.toMatchObject({ status: 'successful' });
  });
});

describe('bugfix: negated "previously used" wording is not a duplicate', () => {
  it.each([
    'Insufficient wallet balance; reference has not previously been used',
    'This reference was never already processed',
  ])('does not read "%s" as a duplicate', (text) => {
    expect(isMonnifyDuplicateReferenceText(text)).toBe(false);
  });

  it('still reads "reference has previously been used" as a duplicate', () => {
    expect(
      isMonnifyDuplicateReferenceText('reference has previously been used')
    ).toBe(true);
  });
});

describe('bugfix: auth codes and wording inside an HTTP requery body prove nothing', () => {
  it.each([
    '401',
    '403',
    '429',
  ])('rethrows an HTTP 400 requery with code %s and vendStatus FAILED', async (code) => {
    mockHttpError(400, {
      responseCode: code,
      responseMessage: 'Rejected',
      responseBody: { vendStatus: 'FAILED' },
    });

    await expect(checkTransactionStatus('MFBP-1')).rejects.toBeDefined();
  });

  it('rethrows an HTTP 400 requery with authentication wording and vendStatus FAILED', async () => {
    mockHttpError(400, {
      responseCode: 'D01',
      responseMessage: 'Invalid access token',
      responseBody: { vendStatus: 'FAILED' },
    });

    await expect(checkTransactionStatus('MFBP-1')).rejects.toBeDefined();
  });
});

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
import { hasMonnifyNonDefinitiveCode } from './monnify-non-definitive-code';
import { hasMonnifyProviderReference } from './monnify-rejection-vend-reference';

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

describe('bugfix: non-vend status values do not leak into the joined wording', () => {
  it('leaves customerStatus/productStatus out of the joined strings', () => {
    expect(
      joinMonnifyAnswerStrings({
        responseMessage: 'Invalid customer',
        responseBody: { customerStatus: 'PENDING', productStatus: 'SUCCESS' },
      })
    ).toBe('Invalid customer');
  });

  it('refunds a purchase rejection that echoes customerStatus PENDING', async () => {
    mockJson({
      requestSuccessful: false,
      responseCode: '01',
      responseMessage: 'Invalid customer',
      responseBody: { customerStatus: 'PENDING', productStatus: 'SUCCESS' },
    });

    await expect(vend()).resolves.toMatchObject({ status: 'failed' });
  });

  it('still holds a rejection that says vendStatus PENDING', async () => {
    mockJson({
      requestSuccessful: false,
      responseCode: '01',
      responseMessage: 'Invalid customer',
      responseBody: { vendStatus: 'PENDING', vendReference: 'MFBP-1' },
    });

    await expect(vend()).resolves.toMatchObject({ status: 'pending' });
  });
});

describe('bugfix: flattened catalog references and nested catalog codes', () => {
  it.each([
    'productReference',
    'billerReference',
    'serviceReference',
    'planReference',
  ])('ignores %s as a vend reference', (key) => {
    expect(
      hasMonnifyProviderReference({ responseBody: { [key]: 'PROD-1' } }, REQ)
    ).toBe(false);
  });

  it('ignores product.details.code 500 (catalog ancestry through recursion)', () => {
    expect(
      hasMonnifyNonDefinitiveCode({
        responseCode: '01',
        responseBody: { product: { details: { code: '500' } } },
      })
    ).toBe(false);
  });

  it('still reads a real nested response code', () => {
    expect(
      hasMonnifyNonDefinitiveCode({
        responseBody: { data: { responseCode: '99' } },
      })
    ).toBe(true);
  });
});

describe('bugfix: an HTTP 409/408 requery with FAILED stays unresolved', () => {
  it.each([
    408, 409,
  ])('rethrows HTTP %i with vendStatus FAILED', async (status) => {
    mockHttpError(status, {
      responseMessage: 'Conflict',
      responseBody: { vendStatus: 'FAILED' },
    });

    await expect(checkTransactionStatus('MFBP-1')).rejects.toBeDefined();
  });

  it('still proves failure on a plain HTTP 400 FAILED body', async () => {
    mockHttpError(400, {
      responseCode: 'D02',
      responseMessage: 'Could not complete',
      responseBody: { vendStatus: 'FAILED' },
    });

    await expect(checkTransactionStatus('MFBP-1')).resolves.toMatchObject({
      status: 'failed',
    });
  });
});

describe('bugfix: a pending vend with a reference and a token is flagged', () => {
  it('sets providerTokenSeen and keeps the requeryable reference, without a pin', async () => {
    mockJson({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: {
        transactionReference: 'MNFY-1',
        vendReference: 'MFBP-1',
        vendStatus: 'PENDING',
        metaData: { token: '1111-2222-3333' },
      },
    });

    const result = await vend();

    expect(result).toMatchObject({
      status: 'pending',
      providerVendReference: 'MFBP-1',
      providerTokenSeen: true,
    });
    expect(result.pin).toBeUndefined();
  });
});

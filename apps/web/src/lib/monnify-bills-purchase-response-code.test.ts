import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCacheLife, mockCacheTag } = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
}));

vi.mock('next/cache', () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock('@/lib/monnify', () => ({
  getMonnifyToken: vi.fn().mockResolvedValue('mock-token'),
}));

vi.mock('@/lib/monnify-provider-config', () => ({
  getMonnifyBaseUrl: () => 'https://sandbox.monnify.com',
}));

import { purchaseBill } from './monnify-bills';

beforeEach(() => {
  vi.clearAllMocks();
});

function vend() {
  return purchaseBill(
    'MTN',
    '13',
    '08012345678',
    100,
    'JANE DOE',
    'BACI-REF-123'
  );
}

function mockHttpError(status: number, statusText: string, body: string) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    text: vi.fn().mockResolvedValue(body),
  });
}

function mockBusinessFailure(envelope: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ requestSuccessful: false, ...envelope }),
  });
}

describe('bugfix: Monnify response code is kept on failed vends', () => {
  it('keeps code 99 from an HTTP 400 "Insufficient funds" refusal', async () => {
    mockHttpError(
      400,
      'Bad Request',
      JSON.stringify({
        requestSuccessful: false,
        responseCode: '99',
        responseMessage: 'Insufficient funds',
      })
    );

    const result = await vend();

    expect(result).toMatchObject({
      providerDefiniteFailure: false,
      providerResponseCode: '99',
      status: 'failed',
    });
  });

  it('keeps the code from an HTTP-200 business rejection', async () => {
    mockBusinessFailure({
      responseCode: 'D02',
      responseMessage: 'Insufficient wallet balance',
    });

    const result = await vend();

    expect(result).toMatchObject({
      providerResponseCode: 'D02',
      status: 'failed',
    });
  });

  it('leaves the code empty for a plain-text error body', async () => {
    mockHttpError(400, 'Bad Request', 'Insufficient funds');

    const result = await vend();

    expect(result.providerResponseCode).toBeUndefined();
    expect(result.providerDefiniteFailure).toBe(true);
  });

  it('never stores a phone-shaped value as the code', async () => {
    mockHttpError(
      400,
      'Bad Request',
      JSON.stringify({ responseCode: '08031234567', responseMessage: 'x' })
    );

    const result = await vend();

    expect(result.providerResponseCode).toBeUndefined();
  });

  it('keeps the code from a form-encoded body with nested fields', async () => {
    mockHttpError(
      400,
      'Bad Request',
      'responseCode=99&responseBody[transactionStatus]=FAILED&responseMessage=Insufficient+funds'
    );

    const result = await vend();

    expect(result.providerResponseCode).toBe('99');
    expect(result.providerDefiniteFailure).toBe(false);
  });
});

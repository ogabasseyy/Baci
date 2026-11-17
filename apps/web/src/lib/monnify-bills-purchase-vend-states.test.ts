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

describe('bugfix: a vend still in flight never goes to Kuda', () => {
  it.each([
    'Vend request pending: insufficient wallet balance',
    'Vend is in progress: insufficient funds',
  ])('keeps "%s" off Kuda', async (responseMessage) => {
    mockBusinessFailure({ responseCode: '01', responseMessage });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('keeps a 4xx whose top-level string status is FAILED off Kuda', async () => {
    mockHttpError(
      400,
      'Bad Request',
      JSON.stringify({
        status: 'FAILED',
        responseMessage: 'Insufficient wallet balance',
      })
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('still hands a 4xx with a numeric HTTP status field to Kuda', async () => {
    mockHttpError(
      400,
      'Bad Request',
      JSON.stringify({
        status: 400,
        responseMessage: 'Insufficient wallet balance',
      })
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: true,
    });
  });
});

describe('bugfix: code 99 read only from response-code keys', () => {
  it('hands a refusal echoing productCode 99 to Kuda', async () => {
    mockBusinessFailure({
      responseCode: '01',
      responseMessage: 'Insufficient wallet balance',
      responseBody: { productCode: '99' },
    });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: true,
    });
  });
});

describe('bugfix: authorization-header rejections read as auth rejections', () => {
  it.each([
    'Authorization header missing',
    'Authorization required',
  ])('hands a 401 saying "%s" to Kuda', async (responseMessage) => {
    mockHttpError(401, 'Unauthorized', JSON.stringify({ responseMessage }));

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: true,
    });
  });
});

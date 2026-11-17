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

describe('bugfix: 401/403 status line alone never reads as an auth rejection', () => {
  it.each([
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
  ])('keeps a %i whose body gives no auth reason off Kuda', async (status, statusText) => {
    mockHttpError(
      status,
      statusText,
      JSON.stringify({ responseMessage: 'Request rejected' })
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('keeps a 401 with an empty body off Kuda', async () => {
    mockHttpError(401, 'Unauthorized', '');

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('still hands a 401 whose body says the token expired to Kuda', async () => {
    mockHttpError(
      401,
      'Unauthorized',
      JSON.stringify({ responseMessage: 'Token expired' })
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: true,
    });
  });
});

describe('bugfix: code 99 read the same way on both paths', () => {
  it('keeps a 4xx whose JSON carries a numeric code 99 off Kuda', async () => {
    mockHttpError(
      400,
      'Bad Request',
      JSON.stringify({
        responseCode: 99,
        responseMessage: 'Insufficient wallet balance',
      })
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('keeps a business rejection with code " 099 " off Kuda', async () => {
    mockBusinessFailure({
      responseCode: ' 099 ',
      responseMessage: 'Insufficient wallet balance',
    });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });
});

describe('bugfix: business rejection showing a vend never goes to Kuda', () => {
  it.each([
    { vendStatus: 'PENDING' },
    { transactionReference: 'MFBP-1' },
    { vendReference: 'BACI-REF-123' },
  ])('keeps a refusal whose body has %j off Kuda', async (responseBody) => {
    mockBusinessFailure({
      responseCode: '01',
      responseMessage: 'Insufficient wallet balance',
      responseBody,
    });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('still hands a plain refusal with no vend in its body to Kuda', async () => {
    mockBusinessFailure({
      responseCode: '01',
      responseMessage: 'Insufficient wallet balance',
    });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: true,
    });
  });

  it('hands "insufficient balance; could not be processed" to Kuda', async () => {
    mockBusinessFailure({
      responseCode: '01',
      responseMessage:
        'Insufficient wallet balance; request could not be processed',
    });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: true,
    });
  });
});

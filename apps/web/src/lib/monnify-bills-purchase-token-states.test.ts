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

describe('bugfix: a delivered token completes the vend even without a known status', () => {
  function mockSuccessEnvelope(responseBody: Record<string, unknown>) {
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

  it('returns success with the token when the vend status is missing', async () => {
    mockSuccessEnvelope({
      transactionReference: 'MNFY-1',
      metaData: { token: '1111-2222-3333', unit: '4.5' },
    });

    await expect(vend()).resolves.toMatchObject({
      success: true,
      status: 'successful',
      pin: '1111-2222-3333',
    });
  });

  it('returns success with the token when the vend status is unrecognised', async () => {
    mockSuccessEnvelope({
      transactionReference: 'MNFY-1',
      vendStatus: 'WEIRD',
      token: 'ABCD-1234',
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'successful',
      pin: 'ABCD-1234',
    });
  });

  it('still holds an unrecognised status with no token', async () => {
    mockSuccessEnvelope({
      transactionReference: 'MNFY-1',
      vendStatus: 'WEIRD',
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });
});

describe('bugfix: an HTTP 5xx on a fresh vend is retried with the same reference, never refunded', () => {
  it.each([
    500, 502, 503,
  ])('throws a transient (retryable) error for HTTP %i instead of returning a failed result', async (status) => {
    mockHttpError(status, 'Server Error', '{"responseMessage":"upstream"}');

    await expect(vend()).rejects.toMatchObject({
      name: 'MonnifyTransientVendError',
    });
  });

  it('sends our request reference as the vendReference, so a retry is deduped by Monnify', async () => {
    mockHttpError(502, 'Bad Gateway', '');

    await expect(vend()).rejects.toThrow();

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const vendCall = calls.find(([url]) =>
      String(url).includes('/bills-payment/vend')
    );
    expect(JSON.parse(String(vendCall?.[1]?.body))).toMatchObject({
      vendReference: 'BACI-REF-123',
    });
  });
});

describe('bugfix: a FAILED vend that carries a token is held, not refunded', () => {
  it('holds a success envelope whose vendStatus is FAILED but carries a token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: true,
        responseCode: '0',
        responseMessage: 'success',
        responseBody: {
          transactionReference: 'MNFY-1',
          vendStatus: 'FAILED',
          metaData: { token: '1111-2222-3333' },
        },
      }),
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });

  it('still fails a FAILED vend with no token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: true,
        responseCode: '0',
        responseMessage: 'success',
        responseBody: { transactionReference: 'MNFY-1', vendStatus: 'FAILED' },
      }),
    });

    await expect(vend()).resolves.toMatchObject({ status: 'failed' });
  });
});

describe('bugfix: blank token and blank vendReference are not evidence', () => {
  function mockEnvelope(responseBody: Record<string, unknown>) {
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

  it('does not complete a vend on a whitespace-only token', async () => {
    mockEnvelope({
      transactionReference: 'MNFY-1',
      vendStatus: 'WEIRD',
      token: '   ',
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });

  it('holds without a requery reference when the vendReference is blank', async () => {
    mockEnvelope({
      transactionReference: 'MNFY-1',
      vendStatus: 'WEIRD',
      vendReference: '   ',
    });

    const result = await vend();

    expect(result).toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
    expect(result.providerVendReference).toBeUndefined();
  });
});

describe('bugfix: a delivered token completes a vend even with no references', () => {
  it('returns success with the token when both references are missing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: true,
        responseCode: '0',
        responseMessage: 'success',
        responseBody: { metaData: { token: '1111-2222-3333' } },
      }),
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'successful',
      pin: '1111-2222-3333',
    });
  });
});

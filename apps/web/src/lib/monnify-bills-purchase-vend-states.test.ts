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

describe('owner decision: a 401/403 login rejection never goes to Kuda', () => {
  it.each([
    'Authorization header missing',
    'Authorization required',
    'Access token has expired',
    'Access token is expired',
    'Authentication failed',
    'Invalid bearer token',
    'Bearer token is invalid',
    'Bearer token missing',
  ])('keeps a 401 saying "%s" off Kuda', async (responseMessage) => {
    mockHttpError(401, 'Unauthorized', JSON.stringify({ responseMessage }));

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('keeps a 401 that only mentions authentication in passing off Kuda', async () => {
    mockHttpError(
      401,
      'Unauthorized',
      JSON.stringify({ responseMessage: 'See authentication docs for help' })
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });
});

describe('bugfix: business rejection naming a vend reference in text stays off Kuda', () => {
  it('keeps "Insufficient wallet balance; vendReference=MFBP-1" off Kuda', async () => {
    mockBusinessFailure({
      responseCode: '01',
      responseMessage: 'Insufficient wallet balance; vendReference=MFBP-1',
    });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });
});

describe('bugfix: plain-text vend references in a business rejection', () => {
  it('keeps a nested reason naming a vend reference off Kuda', async () => {
    mockBusinessFailure({
      responseCode: '01',
      responseMessage: 'Insufficient wallet balance',
      responseBody: { reason: 'transaction reference MFBP-2' },
    });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('still hands a refusal whose top-level reference only echoes ours to Kuda', async () => {
    mockHttpError(
      400,
      'Bad Request',
      JSON.stringify({
        reference: '0123456789abcdef01234567',
        responseMessage: 'Insufficient wallet balance',
      })
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: true,
    });
  });
});

describe('bugfix: non-definitive business response codes stay off Kuda', () => {
  it.each([
    '408',
    '409',
    '429',
  ])('keeps a business code %s off Kuda', async (responseCode) => {
    mockBusinessFailure({
      responseCode,
      responseMessage: 'Insufficient wallet balance',
    });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('keeps a plain-text 4xx with status=FAILED off Kuda', async () => {
    mockHttpError(
      400,
      'Bad Request',
      'status=FAILED&responseMessage=Insufficient wallet balance'
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('hands a machine-formatted INSUFFICIENT_WALLET_BALANCE refusal to Kuda', async () => {
    mockBusinessFailure({
      responseCode: '01',
      responseMessage: 'INSUFFICIENT_WALLET_BALANCE',
    });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: true,
    });
  });

  it('keeps a 403 whose body only mentions "forbidden" in passing off Kuda', async () => {
    mockHttpError(
      403,
      'Forbidden',
      JSON.stringify({
        responseMessage: 'Gateway policy: forbidden region list updated',
      })
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });
});

describe('bugfix: bare plain-text vend states stay off Kuda', () => {
  it.each([
    'Insufficient wallet balance\nFAILED',
    'Insufficient wallet balance - PENDING',
  ])('keeps a plain-text 4xx body %j off Kuda', async (body) => {
    mockHttpError(400, 'Bad Request', body);

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });
});

describe('bugfix: auth wording in the HTTP reason phrase stays off Kuda', () => {
  it.each([
    'Unauthorized',
    'Access Denied',
  ])('keeps a 400 "%s" with a low-balance body off Kuda', async (reason) => {
    mockHttpError(
      400,
      reason,
      JSON.stringify({ responseMessage: 'Insufficient wallet balance' })
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });
});

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

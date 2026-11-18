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

describe('bugfix: nested non-definitive codes and boolean outcome keys', () => {
  it.each([
    '408',
    '409',
    '429',
  ])('keeps a nested responseCode %s off Kuda', async (code) => {
    mockBusinessFailure({
      responseCode: '01',
      responseMessage: 'Insufficient wallet balance',
      responseBody: { responseCode: code },
    });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('hands a refusal with responseBody.processed=false to Kuda', async () => {
    mockBusinessFailure({
      responseCode: '01',
      responseMessage: 'Insufficient wallet balance',
      responseBody: { processed: false },
    });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: true,
    });
  });
});

describe('bugfix: numeric timeout status, transaction status and submitted wording', () => {
  it('keeps a 400 whose body has status 408 off Kuda', async () => {
    mockHttpError(
      400,
      'Bad Request',
      JSON.stringify({ status: 408, message: 'Insufficient wallet balance' })
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('keeps a rejection with transactionStatus FAILED off Kuda', async () => {
    mockHttpError(
      400,
      'Bad Request',
      JSON.stringify({
        transactionStatus: 'FAILED',
        message: 'Insufficient wallet balance',
      })
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('keeps "Vend submitted: insufficient wallet balance" off Kuda', async () => {
    mockBusinessFailure({
      responseCode: '01',
      responseMessage: 'Vend submitted: insufficient wallet balance',
    });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });
});

describe('bugfix guard: a 5xx is never a refusal, whatever its body says', () => {
  it.each([
    500, 502, 503, 504,
  ])('throws a transient (unknown-outcome) error for HTTP %i with refusal wording', async (status) => {
    mockHttpError(
      status,
      'Server Error',
      JSON.stringify({ responseMessage: 'Insufficient wallet balance' })
    );

    await expect(vend()).rejects.toThrow('Transient vend outcome');
  });
});

describe('bugfix: a 401/403 needs a named credential even with refusal wording', () => {
  it.each([
    [401, 'Unauthorized request: insufficient wallet balance'],
    [403, 'Forbidden: insufficient wallet balance'],
  ])('keeps a %i saying "%s" off Kuda', async (status, responseMessage) => {
    mockHttpError(status, 'Denied', JSON.stringify({ responseMessage }));

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });
});

describe('bugfix: form-encoded flags are read by value', () => {
  it.each([
    'isFailed=true&message=Insufficient wallet balance',
    'timedOut=true&message=Insufficient wallet balance',
  ])('keeps "%s" off Kuda', async (body) => {
    mockHttpError(400, 'Bad Request', body);

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('hands "duplicate=false&message=Insufficient wallet balance" to Kuda', async () => {
    mockHttpError(
      400,
      'Bad Request',
      'duplicate=false&message=Insufficient wallet balance'
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: true,
    });
  });
});

describe('bugfix: form-encoded status=false is not a vend state', () => {
  it('hands "status=false&message=Insufficient wallet balance" to Kuda', async () => {
    mockHttpError(
      400,
      'Bad Request',
      'status=false&message=Insufficient wallet balance'
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: true,
    });
  });
});

describe('bugfix: a repeated form field cannot erase a vend state', () => {
  it('keeps "status=FAILED&status=false&…" off Kuda', async () => {
    mockHttpError(
      400,
      'Bad Request',
      'status=FAILED&status=false&message=Insufficient wallet balance'
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });
});

describe('bugfix: a nested form reference is vend evidence, not an echo', () => {
  it('keeps responseBody[reference]=<24 hex>&… off Kuda', async () => {
    mockHttpError(
      400,
      'Bad Request',
      'responseBody[reference]=0123456789abcdef01234567&message=Insufficient+wallet+balance'
    );

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });
});

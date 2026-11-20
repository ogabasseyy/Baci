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

describe('Monnify business answers handed to Kuda', () => {
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

  it('scrubs customer numbers out of a FAILED vend message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: true,
        responseCode: '0',
        responseMessage: 'Vend failed for 08012345678',
        responseBody: { vendReference: 'MFBP-1', vendStatus: 'FAILED' },
      }),
    });

    const result = await vend();
    expect(result.message).not.toContain('08012345678');
  });

  it('spots a duplicate signalled only in the business response body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: false,
        responseCode: '01',
        responseMessage: 'Insufficient wallet balance',
        responseBody: { reason: 'Duplicate vendReference' },
      }),
    });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('never marks code 99 as definite, even with refusal wording', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: false,
        responseCode: '99',
        responseMessage: 'Service unavailable',
      }),
    });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('never marks a FAILED vend that reports a duplicate as definite', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: true,
        responseCode: '0',
        responseMessage: 'Duplicate vendReference',
        responseBody: { vendReference: 'MFBP-1', vendStatus: 'FAILED' },
      }),
    });

    const result = await vend();
    expect(result.status).toBe('failed');
    expect(result.providerDefiniteFailure).toBeUndefined();
  });

  it('never marks Monnify code 99 (unexpected error) as definite', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: false,
        responseCode: '99',
        responseMessage: 'An unexpected error occurred while processing',
      }),
    });

    // Code 99 means "re-query": the outcome is open, so the row is held.
    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
      providerOutcomeUnresolved: true,
      status: 'pending',
    });
  });

  it('scrubs customer numbers out of a business rejection message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: false,
        responseCode: '01',
        responseMessage: 'Insufficient balance for customer 08012345678',
      }),
    });

    const result = await vend();
    expect(result.message).not.toContain('08012345678');
    expect(result.providerDefiniteFailure).toBe(true);
  });

  it('marks a business rejection as definite unless it reports a duplicate', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: false,
        responseCode: '01',
        responseMessage: 'Insufficient Balance',
      }),
    });
    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: true,
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: false,
        responseCode: '99',
        responseMessage: 'Duplicate transaction reference',
      }),
    });
    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: false,
        responseCode: 'DUPLICATE_REFERENCE',
        responseMessage: 'Request failed',
      }),
    });
    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });

  it('never marks a FAILED vend status as definite', async () => {
    // FAILED can follow a hand-off to the network, so it is not proof
    // that nothing was delivered.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: true,
        responseCode: '0',
        responseMessage: 'success',
        responseBody: { vendReference: 'MFBP-1', vendStatus: 'FAILED' },
      }),
    });

    const result = await vend();
    expect(result.status).toBe('failed');
    expect(result.providerDefiniteFailure).toBeUndefined();
  });

  it('never marks a business rejection that mentions a vend outcome as definite', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: false,
        responseCode: '01',
        responseMessage: 'Insufficient wallet balance - Vend request failed',
      }),
    });

    await expect(vend()).resolves.toMatchObject({
      providerDefiniteFailure: false,
    });
  });
});

describe('bugfix: Codex wording rounds through purchaseBill', () => {
  function vendWith(envelope: Record<string, unknown>) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi
        .fn()
        .mockResolvedValue({ requestSuccessful: false, ...envelope }),
    });
    return purchaseBill('MTN', '13', '08012345678', 100, 'JANE DOE', 'R-1');
  }

  it('keeps "Authorization failed: insufficient wallet balance" off Kuda', async () => {
    await expect(
      vendWith({
        responseCode: '01',
        responseMessage: 'Authorization failed: insufficient wallet balance',
      })
    ).resolves.toMatchObject({ providerDefiniteFailure: false });
  });

  it('keeps a low-balance refusal with airtimeCredited true off Kuda', async () => {
    await expect(
      vendWith({
        responseCode: '01',
        responseMessage: 'Insufficient wallet balance',
        responseBody: { airtimeCredited: true },
      })
    ).resolves.toMatchObject({ providerDefiniteFailure: false });
  });

  it('hands "Wallet balance too low" to Kuda', async () => {
    await expect(
      vendWith({
        responseCode: '01',
        responseMessage: 'Wallet balance too low',
      })
    ).resolves.toMatchObject({ providerDefiniteFailure: true });
  });
});

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

import { checkTransactionStatus } from './monnify-bills';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Monnify bill requery', () => {
  it('queries by transactionReference in URL and resolves success', async () => {
    const mockResponse = {
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: {
        transactionReference: 'MON-TX-123',
        status: 'PAID',
        token: 'TOKEN-1234',
      },
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });
    global.fetch = fetchSpy;

    const result = await checkTransactionStatus('MON-TX-123');
    expect(result).toEqual({
      status: 'successful',
      message: 'success',
      pin: 'TOKEN-1234',
    });

    const lastFetchUrl = fetchSpy.mock.calls[0][0].toString();
    expect(lastFetchUrl).toContain('reference=MON-TX-123');
    expect(lastFetchUrl).not.toContain('transactionReference=');
  });

  it('extracts the token from nested responseBody.metaData.token', async () => {
    const mockResponse = {
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: {
        transactionReference: 'MON-TX-123',
        vendStatus: 'SUCCESS',
        metaData: { token: '3772-0340-4164-5060-0336', unit: '4.5' },
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await checkTransactionStatus('MON-TX-123');
    expect(result.status).toBe('successful');
    expect(result.pin).toBe('3772-0340-4164-5060-0336');
    // Units must also be surfaced so the fallback poll can persist them.
    expect(result.units).toBe('4.5');
  });

  it('supports vendStatus when status is missing', async () => {
    const mockResponse = {
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: {
        transactionReference: 'MON-TX-123',
        vendStatus: 'SUCCESSFUL',
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await checkTransactionStatus('MON-TX-123');
    expect(result.status).toBe('successful');
  });

  it('falls back to payment status when requery vendStatus is blank', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: true,
        responseCode: '0',
        responseMessage: 'success',
        responseBody: {
          transactionReference: 'MON-TX-123',
          status: 'PAID',
          vendStatus: '',
          token: 'TOKEN-1234',
        },
      }),
    });

    const result = await checkTransactionStatus('MON-TX-123');
    expect(result).toEqual({
      status: 'successful',
      message: 'success',
      pin: 'TOKEN-1234',
    });
  });

  it('reports processing when vendStatus is in progress despite paid status', async () => {
    // Regression: a requery during async token delivery — payment captured
    // (status PAID) but vend still IN_PROGRESS. Must report processing (no
    // pin) so reconciliation keeps polling instead of finalizing token-less.
    const mockResponse = {
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'processing',
      responseBody: {
        transactionReference: 'MON-TX-123',
        status: 'PAID',
        vendStatus: 'IN_PROGRESS',
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await checkTransactionStatus('MON-TX-123');
    expect(result.status).toBe('processing');
    expect(result.pin).toBeUndefined();
  });

  it('never fails a row on a rejected requery whose body says SUCCESSFUL', async () => {
    const mockResponse = {
      requestSuccessful: true,
      responseCode: '1',
      responseMessage: 'Status lookup failed',
      responseBody: {
        transactionReference: 'MON-TX-123',
        vendStatus: 'SUCCESSFUL',
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await checkTransactionStatus('MON-TX-123');
    // Not proof of failure (the vend reads SUCCESSFUL): left processing,
    // where a refund could pay the customer twice.
    expect(result.status).toBe('unknown');
    expect(result.message).toContain('Status lookup failed');
  });

  it('propagates/throws transient status check errors rather than failing row', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    });

    await expect(checkTransactionStatus('MON-TX-123')).rejects.toThrow(
      'Monnify server error: 502'
    );
  });
});

describe('bugfix: requery failures keep the Monnify response code', () => {
  it('returns the shape-checked code on a failed requery', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: false,
        responseCode: 'D02',
        responseMessage: 'Vend failed',
      }),
    });

    const result = await checkTransactionStatus('MFBP-MDR-1');

    expect(result).toMatchObject({ status: 'failed', responseCode: 'D02' });
  });

  it('drops a phone-shaped code on a failed requery', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: false,
        responseCode: '08031234567',
        responseMessage: 'Vend failed',
      }),
    });

    const result = await checkTransactionStatus('MFBP-MDR-1');

    expect(result.status).toBe('failed');
    expect(result.responseCode).toBeUndefined();
  });
});

describe('bugfix: a returned requery token completes the vend even with an unknown status', () => {
  it('returns successful with the token when the status is missing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: true,
        responseCode: '0',
        responseMessage: 'success',
        responseBody: {
          transactionReference: 'MON-TX-1',
          metaData: { token: '1111-2222-3333', unit: '4.5' },
        },
      }),
    });

    const result = await checkTransactionStatus('MFBP-1');

    expect(result).toMatchObject({
      status: 'successful',
      pin: '1111-2222-3333',
      units: '4.5',
    });
  });

  it('stays unknown for an unrecognised status with no token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: true,
        responseCode: '0',
        responseMessage: 'success',
        responseBody: { transactionReference: 'MON-TX-1', vendStatus: 'WEIRD' },
      }),
    });

    await expect(checkTransactionStatus('MFBP-1')).resolves.toMatchObject({
      status: 'unknown',
    });
  });
});

describe('bugfix: a FAILED requery that returns a token is not proof of failure', () => {
  it('returns unknown for vendStatus FAILED with a token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestSuccessful: true,
        responseCode: '0',
        responseMessage: 'success',
        responseBody: {
          transactionReference: 'MON-TX-1',
          vendStatus: 'FAILED',
          metaData: { token: '1111-2222-3333' },
        },
      }),
    });

    await expect(checkTransactionStatus('MFBP-1')).resolves.toMatchObject({
      status: 'unknown',
    });
  });
});

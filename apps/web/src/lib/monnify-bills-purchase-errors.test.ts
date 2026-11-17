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

import { MonnifyTransientVendError, purchaseBill } from './monnify-bills';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Monnify bill purchase errors', () => {
  it('returns terminal failed status on business failure (requestSuccessful: false)', async () => {
    const mockResponse = {
      requestSuccessful: false,
      responseCode: '99',
      responseMessage: 'Insufficient Balance',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await purchaseBill(
      'IKEDC',
      'IKEDC-PREPAID',
      '12345678',
      2000,
      'JANE DOE',
      'BACI-REF-123'
    );
    expect(result.status).toBe('failed');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Insufficient Balance');
  });

  it('returns terminal failed status on HTTP 4xx API errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          responseMessage:
            'Insufficient wallet balance for customer 08012345678',
        })
      ),
    });

    const result = await purchaseBill(
      'IKEDC',
      'IKEDC-PREPAID',
      '12345678',
      2000,
      'JANE DOE',
      'BACI-REF-123'
    );
    expect(result.status).toBe('failed');
    expect(result.success).toBe(false);
    expect(result.message).toBe(
      'Monnify rejected the bill payment request. Please verify the details and try again.'
    );
    expect(result.providerErrorDetail).toContain(
      'Monnify API error: 400 Bad Request - Insufficient wallet balance'
    );
    expect(result.providerErrorDetail).toContain('[redacted]');
    expect(result.providerErrorDetail).not.toContain('08012345678');
  });

  describe('bugfix: which Monnify vend failures may be handed to Kuda', () => {
    function mockHttpError(
      status: number,
      statusText: string,
      message: string
    ) {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status,
        statusText,
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ responseMessage: message })),
      });
    }

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

    it('treats HTTP 408 as an unknown outcome to resubmit', async () => {
      mockHttpError(408, 'Request Timeout', 'Request timed out');

      await expect(vend()).rejects.toBeInstanceOf(MonnifyTransientVendError);
    });

    it('marks a plain 4xx refusal as definite', async () => {
      mockHttpError(400, 'Bad Request', 'Insufficient wallet balance');

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: true,
        status: 'failed',
      });
    });

    it.each([
      [409, 'Conflict', 'Request conflict'],
      [400, 'Bad Request', 'Duplicate vendReference'],
      [400, 'Bad Request', 'Reference has already been used'],
    ])('never marks a duplicate reference (%i %s) as definite', async (status, statusText, message) => {
      mockHttpError(status, statusText, message);

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
        status: 'failed',
      });
    });

    it('marks a business rejection as definite unless it reports a duplicate', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          requestSuccessful: false,
          responseCode: '99',
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
    });

    it('marks only an explicit FAILED vend status as definite', async () => {
      function mockVendStatus(vendStatus: string) {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            requestSuccessful: true,
            responseCode: '0',
            responseMessage: 'success',
            responseBody: { vendReference: 'MFBP-1', vendStatus },
          }),
        });
      }

      mockVendStatus('FAILED');
      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: true,
        status: 'failed',
      });

      mockVendStatus('SOMETHING_NEW');
      const unknown = await vend();
      expect(unknown.status).toBe('failed');
      expect(unknown.providerDefiniteFailure).toBeUndefined();
    });
  });

  it('falls back to sanitized raw JSON when Monnify omits message fields', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          errors: [{ field: 'customerId', value: '08012345678' }],
        })
      ),
    });

    const result = await purchaseBill(
      'IKEDC',
      'IKEDC-PREPAID',
      '12345678',
      2000,
      'JANE DOE',
      'BACI-REF-123'
    );

    expect(result.status).toBe('failed');
    expect(result.message).toBe(
      'Monnify rejected the bill payment request. Please verify the details and try again.'
    );
    expect(result.providerErrorDetail).toContain(
      'Monnify API error: 400 Bad Request -'
    );
    expect(result.providerErrorDetail).toContain('customerId');
    expect(result.providerErrorDetail).toContain('[redacted]');
    expect(result.providerErrorDetail).not.toContain('08012345678');
  });

  it('sanitizes plain-text HTTP error bodies before returning terminal 4xx failures', async () => {
    const longTail = 'x'.repeat(260);
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: vi
        .fn()
        .mockResolvedValue(
          `Plain error code 123456 customer 1234567 ${longTail} not-visible`
        ),
    });

    const result = await purchaseBill(
      'IKEDC',
      'IKEDC-PREPAID',
      '12345678',
      2000,
      'JANE DOE',
      'BACI-REF-123'
    );

    expect(result.status).toBe('failed');
    expect(result.message).toBe(
      'Monnify rejected the bill payment request. Please verify the details and try again.'
    );
    expect(result.providerErrorDetail).toContain(
      'Plain error code 123456 customer'
    );
    expect(result.providerErrorDetail).toContain('[redacted]');
    expect(result.providerErrorDetail).not.toContain('1234567');
    expect(result.providerErrorDetail).not.toContain('not-visible');
  });

  it('redacts sensitive digit sequences that cross the error detail boundary', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: vi.fn().mockResolvedValue(`${'x'.repeat(235)} 9876543 tail`),
    });

    const result = await purchaseBill(
      'IKEDC',
      'IKEDC-PREPAID',
      '12345678',
      2000,
      'JANE DOE',
      'BACI-REF-123'
    );

    expect(result.status).toBe('failed');
    expect(result.message).not.toContain('9876');
    expect(result.providerErrorDetail).not.toContain('9876');
    expect(result.providerErrorDetail).toContain('[red');
  });

  it('redacts sensitive digit sequences embedded next to letters and underscores', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: vi
        .fn()
        .mockResolvedValue(
          'Lookup failed for customer_08012345678 and id123456789'
        ),
    });

    const result = await purchaseBill(
      'IKEDC',
      'IKEDC-PREPAID',
      '12345678',
      2000,
      'JANE DOE',
      'BACI-REF-123'
    );

    expect(result.status).toBe('failed');
    expect(result.message).toBe(
      'Monnify rejected the bill payment request. Please verify the details and try again.'
    );
    expect(result.providerErrorDetail).toContain('customer_[redacted]');
    expect(result.providerErrorDetail).toContain('id[redacted]');
    expect(result.providerErrorDetail).not.toContain('08012345678');
    expect(result.providerErrorDetail).not.toContain('123456789');
  });
});

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

    it.each([
      [401, 'Unauthorized'],
      [403, 'Forbidden'],
    ])('marks an authentication rejection (%i) as definite', async (status, statusText) => {
      mockHttpError(status, statusText, 'Access denied');

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: true,
        status: 'failed',
      });
    });

    it.each([
      [401, 'Unauthorized'],
      [403, 'Forbidden'],
    ])('never marks an authentication answer (%i) that reports a duplicate as definite', async (status, statusText) => {
      mockHttpError(status, statusText, 'Duplicate vendReference');

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
      });
    });

    it('never hands a 408 timeout to Kuda', async () => {
      mockHttpError(408, 'Request Timeout', 'Insufficient wallet balance');

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
        status: 'failed',
      });
    });

    it('spots a duplicate mentioned after the first 240 characters', async () => {
      const longTail = `Insufficient wallet balance. ${'x'.repeat(300)} Duplicate vendReference`;
      mockHttpError(400, 'Bad Request', longTail);
      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          requestSuccessful: false,
          responseCode: '01',
          responseMessage: longTail,
        }),
      });
      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
      });
    });

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

    it('does not mark a 4xx outside the known refusals as definite', async () => {
      mockHttpError(400, 'Bad Request', 'Invalid customer reference');

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
        status: 'failed',
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

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
        status: 'failed',
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
      [400, 'Bad Request', 'Reference exists'],
      [400, 'Bad Request', 'vendReference in use'],
      [422, 'Unprocessable Entity', 'Request conflict'],
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

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

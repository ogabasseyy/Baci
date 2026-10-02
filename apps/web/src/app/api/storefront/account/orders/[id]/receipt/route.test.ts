import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthResult } from '@/lib/api-auth';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
}));

vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/receipt-pdf-generator', () => ({
  generateReceiptBlob: vi.fn(),
}));

vi.mock('@/lib/storefront-account-document-data', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/storefront-account-document-data')
  >('@/lib/storefront-account-document-data');

  return {
    ...actual,
    getStorefrontAccountDocumentData: vi.fn(),
  };
});

import { authenticateApiRequest } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limiter';
import { generateReceiptBlob } from '@/lib/receipt-pdf-generator';
import {
  getStorefrontAccountDocumentData,
  StorefrontAccountDocumentError,
} from '@/lib/storefront-account-document-data';
import { GET } from './route';

type StorefrontAccountDocumentData = Awaited<
  ReturnType<typeof getStorefrontAccountDocumentData>
>;
const ORDER_ID = 'cfa945fc-9bf4-4485-857c-4d4374adf31f';
const MERCHANT_SLUG = 'ogabassey';

function createAuthenticatedAuthResult(): AuthResult {
  return {
    user: { id: 'user-1' } as User,
    error: null,
    supabase: {} as SupabaseClient,
  };
}

function createDocumentData(
  overrides: Partial<StorefrontAccountDocumentData['order']>
): StorefrontAccountDocumentData {
  const order = {
    id: 'order-1',
    order_number: 'ORD-1001',
    created_at: '2026-03-22T10:00:00.000Z',
    total: 100000,
    payment_status: 'paid',
    shipping_status: 'shipped',
    items: [],
    receipt_eligible: true,
    current_document_kind: 'receipt',
    ...overrides,
  };

  return {
    order,
    invoiceData: {} as StorefrontAccountDocumentData['invoiceData'],
    receiptOrder: {
      order_number: order.order_number,
    } as StorefrontAccountDocumentData['receiptOrder'],
    receiptMerchant: {
      business_name: 'Ogabassey',
    } as StorefrontAccountDocumentData['receiptMerchant'],
  } as StorefrontAccountDocumentData;
}

function createRequest(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

function requestReceipt(input?: { id?: string; merchantSlug?: string | null }) {
  const id = input?.id ?? ORDER_ID;
  const merchantSlug =
    input && 'merchantSlug' in input ? input.merchantSlug : MERCHANT_SLUG;
  const query = merchantSlug ? `?merchantSlug=${merchantSlug}` : '';

  return GET(
    createRequest(`/api/storefront/account/orders/${id}/receipt${query}`),
    {
      params: Promise.resolve({ id }),
    }
  );
}

describe('GET /api/storefront/account/orders/[id]/receipt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
  });

  it('returns 401 when the customer is not authenticated', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });

    const response = await requestReceipt();

    expect(response.status).toBe(401);
  });

  it('returns 429 when the download rate limit is exceeded', async () => {
    const authResult = createAuthenticatedAuthResult();

    vi.mocked(authenticateApiRequest).mockResolvedValue(authResult);
    vi.mocked(checkRateLimit).mockResolvedValue(false);

    const response = await requestReceipt();

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    await expect(response.json()).resolves.toEqual({
      error: 'Rate limit exceeded. Please try again later.',
    });
    expect(checkRateLimit).toHaveBeenCalledWith(
      authResult.supabase,
      'user-1',
      'storefront_account_receipt_download',
      10,
      1
    );
  });

  it('returns 400 when the order id is invalid', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );

    const response = await requestReceipt({
      id: 'not-a-uuid',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid request',
    });
  });

  it('returns 400 when merchantSlug is missing', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );

    const response = await requestReceipt({
      merchantSlug: null,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid request',
    });
  });

  it('returns 409 when the order is not yet eligible for a receipt', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(getStorefrontAccountDocumentData).mockResolvedValue(
      createDocumentData({
        receipt_eligible: false,
        current_document_kind: 'invoice',
      })
    );

    const response = await requestReceipt();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Receipt is not available for this order yet',
      code: 'RECEIPT_NOT_READY',
    });
  });

  it('returns a sanitized PDF download for an eligible receipt', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(getStorefrontAccountDocumentData).mockResolvedValue(
      createDocumentData({
        order_number: 'ORD-1001\r\nSet-Cookie: evil',
      })
    );
    vi.mocked(generateReceiptBlob).mockReturnValue(new Blob(['receipt']));

    const response = await requestReceipt();

    const contentDisposition = response.headers.get('content-disposition');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(contentDisposition).toContain(
      'receipt-ORD-1001-Set-Cookie-evil.pdf'
    );
    expect(contentDisposition).not.toContain('\r');
    expect(contentDisposition).not.toContain('\n');
    // The route serves settled balances whose payment flag is not 'paid',
    // so the generator must not infer the kind from that flag.
    expect(vi.mocked(generateReceiptBlob)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { documentKind: 'receipt' }
    );
  });

  it('maps document access errors to API responses', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(getStorefrontAccountDocumentData).mockRejectedValue(
      new StorefrontAccountDocumentError('Order not found', 404, 'NOT_FOUND')
    );

    const response = await requestReceipt();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Order not found',
      code: 'NOT_FOUND',
    });
  });

  it('logs and returns 500 for unexpected failures', async () => {
    const loggerErrorSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    try {
      vi.mocked(authenticateApiRequest).mockResolvedValue(
        createAuthenticatedAuthResult()
      );
      vi.mocked(getStorefrontAccountDocumentData).mockRejectedValue(
        new Error('Receipt generation failed')
      );

      const response = await requestReceipt();

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: 'Internal server error',
      });
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Unexpected storefront receipt download error',
          route: 'storefront/account/orders/[id]/receipt',
          error: expect.any(Error),
        })
      );
    } finally {
      loggerErrorSpy.mockRestore();
    }
  });

  it('returns 500 when receipt PDF generation fails', async () => {
    const loggerErrorSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);

    try {
      vi.mocked(authenticateApiRequest).mockResolvedValue(
        createAuthenticatedAuthResult()
      );
      vi.mocked(getStorefrontAccountDocumentData).mockResolvedValue(
        createDocumentData({})
      );
      vi.mocked(generateReceiptBlob).mockImplementation(() => {
        throw new Error('PDF generation failed');
      });

      const response = await requestReceipt();

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: 'Internal server error',
      });
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Unexpected storefront receipt download error',
          route: 'storefront/account/orders/[id]/receipt',
          error: expect.any(Error),
        })
      );
    } finally {
      loggerErrorSpy.mockRestore();
    }
  });
});

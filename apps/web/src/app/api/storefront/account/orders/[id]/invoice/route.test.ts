import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthResult } from '@/lib/api-auth';

const { mockGeneratePeppolInvoiceXml, mockResolveReceiptLogoDataUri } =
  vi.hoisted(() => ({
    mockGeneratePeppolInvoiceXml: vi.fn(() => '<Invoice />'),
    mockResolveReceiptLogoDataUri: vi.fn(
      (): Promise<string | null> => Promise.resolve(null)
    ),
  }));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
}));

vi.mock('@/lib/receipt-pdf-generator', () => ({
  generateReceiptBlob: vi.fn(),
  resolveReceiptLogoDataUri: mockResolveReceiptLogoDataUri,
}));

vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/peppol-ubl-invoice', () => ({
  generatePeppolInvoiceXml: mockGeneratePeppolInvoiceXml,
  PEPPOL_BIS_BILLING_COMPLIANCE_NOTE:
    'This invoice complies with Peppol BIS Billing 3.0 through a generated UBL XML invoice artifact created from this order.',
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
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

function createAuthenticatedAuthResult(): AuthResult {
  return {
    user: { id: 'user-1' } as User,
    error: null,
    supabase: {} as SupabaseClient,
  };
}

function createDocumentData(
  orderNumber: string
): StorefrontAccountDocumentData {
  return {
    order: {
      id: 'order-1',
      order_number: orderNumber,
      created_at: '2026-03-22T10:00:00.000Z',
      total: 100000,
      payment_status: 'paid',
      shipping_status: 'processing',
      items: [],
      receipt_eligible: false,
      current_document_kind: 'invoice',
    },
    invoiceData: {
      invoice_number: orderNumber,
      invoice_type_code: '380',
      buyer_reference: 'BUYER-REF-001',
      issue_date: new Date('2026-04-01T00:00:00.000Z'),
      due_date: new Date('2026-04-15T00:00:00.000Z'),
      payment_terms: 'Net 14',
      firs_irn: 'IRN-2026-001',
      firs_csid: 'CSID-2026-001',
      notes: 'Invoice note',
      items: [
        {
          line_id: 1,
          product_id: 'product-1',
          name: 'iPhone 15 Pro',
          description: 'IMEI: 123456789012345',
          quantity: 1,
          unit_code: 'EA',
          price: 100000,
          line_extension_amount: 100000,
          sellers_item_id: 'SELLER-IPHONE-15',
          vat_amount: 7500,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
      tax_subtotals: [
        {
          taxable_amount: 100000,
          tax_amount: 7500,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
    } as StorefrontAccountDocumentData['invoiceData'],
    receiptOrder: {
      items: [
        {
          line_id: 1,
          product_id: 'product-1',
          product_name: 'iPhone 15 Pro',
          quantity: 1,
          price: 100000,
        },
      ],
    } as StorefrontAccountDocumentData['receiptOrder'],
    receiptMerchant: {
      registered_address: {
        street: '99 Registered Road',
      },
    } as StorefrontAccountDocumentData['receiptMerchant'],
  } as StorefrontAccountDocumentData;
}

describe('GET /api/storefront/account/orders/[id]/invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    mockGeneratePeppolInvoiceXml.mockReturnValue('<Invoice />');
    mockResolveReceiptLogoDataUri.mockResolvedValue(
      'data:image/png;base64,AA=='
    );
  });

  it('returns 401 when the customer is not authenticated', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/cfa945fc-9bf4-4485-857c-4d4374adf31f/invoice?merchantSlug=ogabassey'
      ),
      {
        params: Promise.resolve({
          id: 'cfa945fc-9bf4-4485-857c-4d4374adf31f',
        }),
      }
    );

    expect(response.status).toBe(401);
  });

  it('returns 401 before awaiting route params when unauthenticated', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
    const paramsThen = vi.fn();
    const params = {} as Promise<{ id: string }>;
    Object.defineProperty(params, 'then', {
      value: paramsThen,
    });

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/not-a-uuid/invoice'
      ),
      {
        params,
      }
    );

    expect(response.status).toBe(401);
    expect(paramsThen).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it('returns 429 when the download rate limit is exceeded', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(checkRateLimit).mockResolvedValue(false);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/cfa945fc-9bf4-4485-857c-4d4374adf31f/invoice?merchantSlug=ogabassey'
      ),
      {
        params: Promise.resolve({
          id: 'cfa945fc-9bf4-4485-857c-4d4374adf31f',
        }),
      }
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    await expect(response.json()).resolves.toEqual({
      error: 'Rate limit exceeded. Please try again later.',
    });
  });

  it('returns 400 when merchantSlug is missing', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/cfa945fc-9bf4-4485-857c-4d4374adf31f/invoice'
      ),
      {
        params: Promise.resolve({
          id: 'cfa945fc-9bf4-4485-857c-4d4374adf31f',
        }),
      }
    );

    expect(response.status).toBe(400);
  });

  it('returns 400 when the order id is invalid', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/not-a-uuid/invoice?merchantSlug=ogabassey'
      ),
      {
        params: Promise.resolve({
          id: 'not-a-uuid',
        }),
      }
    );

    expect(response.status).toBe(400);
  });

  it('returns a sanitized PDF download for a valid customer-owned order', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(getStorefrontAccountDocumentData).mockResolvedValue(
      createDocumentData('ORD-1001\r\nSet-Cookie: evil')
    );
    vi.mocked(generateReceiptBlob).mockReturnValue(new Blob(['invoice']));

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/cfa945fc-9bf4-4485-857c-4d4374adf31f/invoice?merchantSlug=ogabassey'
      ),
      {
        params: Promise.resolve({
          id: 'cfa945fc-9bf4-4485-857c-4d4374adf31f',
        }),
      }
    );

    const contentDisposition = response.headers.get('content-disposition');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(generateReceiptBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            description: 'IMEI: 123456789012345',
            line_extension_amount: 100000,
            sellers_item_id: 'SELLER-IPHONE-15',
            unit_code: 'EA',
            vat_amount: 7500,
            vat_category_code: 'S',
            vat_rate: 7.5,
          }),
        ],
      }),
      expect.objectContaining({
        registered_address: expect.objectContaining({
          street: '99 Registered Road',
        }),
      }),
      {
        buyerReference: 'BUYER-REF-001',
        documentDate: new Date('2026-04-01T00:00:00.000Z'),
        documentKind: 'invoice',
        dueDate: new Date('2026-04-15T00:00:00.000Z'),
        firsCsid: 'CSID-2026-001',
        firsIrn: 'IRN-2026-001',
        invoiceTypeCode: '380',
        invoiceNotes: 'Invoice note',
        logoDataUri: 'data:image/png;base64,AA==',
        paymentTerms: 'Net 14',
        taxSubtotals: [
          {
            taxable_amount: 100000,
            tax_amount: 7500,
            vat_category_code: 'S',
            vat_rate: 7.5,
          },
        ],
      }
    );
    expect(
      vi.mocked(generateReceiptBlob).mock.calls[0]?.[2]
    ).not.toHaveProperty('complianceNote');
    expect(contentDisposition).toContain(
      'invoice-ORD-1001-Set-Cookie-evil.pdf'
    );
    expect(contentDisposition).not.toContain('\r');
    expect(contentDisposition).not.toContain('\n');
  });

  it('names type-325 downloads as proforma documents', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    const documentData = createDocumentData('ORD-2002');
    documentData.invoiceData.invoice_type_code = '325';
    vi.mocked(getStorefrontAccountDocumentData).mockResolvedValue(documentData);
    vi.mocked(generateReceiptBlob).mockReturnValue(new Blob(['proforma']));

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/cfa945fc-9bf4-4485-857c-4d4374adf31f/invoice?merchantSlug=ogabassey'
      ),
      {
        params: Promise.resolve({
          id: 'cfa945fc-9bf4-4485-857c-4d4374adf31f',
        }),
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain(
      'proforma-ORD-2002.pdf'
    );
  });

  it('matches receipt item metadata by line id instead of invoice array position', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    const documentData = createDocumentData('ORD-1001');
    documentData.receiptOrder.items = [
      {
        line_id: 1,
        product_id: 'product-1',
        product_name: 'First item',
        quantity: 1,
        price: 100000,
      },
      {
        line_id: 2,
        product_id: 'product-2',
        product_name: 'Second item',
        quantity: 1,
        price: 200000,
      },
    ];
    documentData.invoiceData.items = [
      {
        line_id: 2,
        product_id: 'product-2',
        name: 'Second item',
        description: 'Second line metadata',
        quantity: 1,
        unit_code: 'EA',
        price: 200000,
        line_extension_amount: 200000,
        sellers_item_id: 'SELLER-SECOND',
        vat_amount: 15000,
        vat_category_code: 'S',
        vat_rate: 7.5,
      },
      {
        line_id: 1,
        product_id: 'product-1',
        name: 'First item',
        description: 'First line metadata',
        quantity: 1,
        unit_code: 'EA',
        price: 100000,
        line_extension_amount: 100000,
        sellers_item_id: 'SELLER-FIRST',
        vat_amount: 7500,
        vat_category_code: 'S',
        vat_rate: 7.5,
      },
    ];
    vi.mocked(getStorefrontAccountDocumentData).mockResolvedValue(documentData);
    vi.mocked(generateReceiptBlob).mockReturnValue(new Blob(['invoice']));

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/cfa945fc-9bf4-4485-857c-4d4374adf31f/invoice?merchantSlug=ogabassey'
      ),
      {
        params: Promise.resolve({
          id: 'cfa945fc-9bf4-4485-857c-4d4374adf31f',
        }),
      }
    );

    expect(response.status).toBe(200);
    expect(generateReceiptBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            description: 'First line metadata',
            sellers_item_id: 'SELLER-FIRST',
          }),
          expect.objectContaining({
            description: 'Second line metadata',
            sellers_item_id: 'SELLER-SECOND',
          }),
        ],
      }),
      expect.anything(),
      expect.anything()
    );
  });

  it('keeps generating the branded PDF when Peppol XML generation fails', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(getStorefrontAccountDocumentData).mockResolvedValue(
      createDocumentData('ORD-1001')
    );
    mockGeneratePeppolInvoiceXml.mockImplementationOnce(() => {
      throw new Error('missing buyer endpoint');
    });
    vi.mocked(generateReceiptBlob).mockReturnValue(new Blob(['invoice']));

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/cfa945fc-9bf4-4485-857c-4d4374adf31f/invoice?merchantSlug=ogabassey'
      ),
      {
        params: Promise.resolve({
          id: 'cfa945fc-9bf4-4485-857c-4d4374adf31f',
        }),
      }
    );

    expect(response.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Generated branded invoice PDF without Peppol UBL validation',
      })
    );
    expect(
      vi.mocked(generateReceiptBlob).mock.calls[0]?.[2]
    ).not.toHaveProperty('complianceNote');
  });

  it('maps document access errors to API responses', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(getStorefrontAccountDocumentData).mockRejectedValue(
      new StorefrontAccountDocumentError('Order not found', 404, 'NOT_FOUND')
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/cfa945fc-9bf4-4485-857c-4d4374adf31f/invoice?merchantSlug=ogabassey'
      ),
      {
        params: Promise.resolve({
          id: 'cfa945fc-9bf4-4485-857c-4d4374adf31f',
        }),
      }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Order not found',
      code: 'NOT_FOUND',
    });
  });

  it('logs and returns 500 for unexpected failures', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(getStorefrontAccountDocumentData).mockRejectedValue(
      new Error('Invoice generation failed')
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/cfa945fc-9bf4-4485-857c-4d4374adf31f/invoice?merchantSlug=ogabassey'
      ),
      {
        params: Promise.resolve({
          id: 'cfa945fc-9bf4-4485-857c-4d4374adf31f',
        }),
      }
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Internal server error',
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Unexpected storefront invoice download error:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });
});

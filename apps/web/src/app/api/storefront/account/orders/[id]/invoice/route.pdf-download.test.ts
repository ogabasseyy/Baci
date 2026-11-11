import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoiceTestSupport } from './route.test-support';

const {
  mockGeneratePeppolInvoiceXml,
  mockResolveReceiptLogoDataUri,
  authenticateApiRequest,
  checkRateLimit,
  generateReceiptBlob,
  getStorefrontAccountDocumentData,
  GET,
  createAuthenticatedAuthResult,
  createDocumentData,
} = invoiceTestSupport;

describe('GET /api/storefront/account/orders/[id]/invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    mockGeneratePeppolInvoiceXml.mockReturnValue('<Invoice />');
    mockResolveReceiptLogoDataUri.mockResolvedValue(
      'data:image/png;base64,AA=='
    );
  });

  it('returns a sanitized PDF download for a valid customer-owned order', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(getStorefrontAccountDocumentData).mockResolvedValue(
      createDocumentData('ORD-1001\r\nSet-Cookie: evil')
    );
    vi.mocked(generateReceiptBlob).mockResolvedValue(new Blob(['invoice']));

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
    vi.mocked(generateReceiptBlob).mockResolvedValue(new Blob(['proforma']));

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
});

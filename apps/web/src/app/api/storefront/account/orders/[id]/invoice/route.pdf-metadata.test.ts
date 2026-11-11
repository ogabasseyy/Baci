import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoiceTestSupport } from './route.test-support';

const {
  mockGeneratePeppolInvoiceXml,
  mockResolveReceiptLogoDataUri,
  authenticateApiRequest,
  logger,
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
});

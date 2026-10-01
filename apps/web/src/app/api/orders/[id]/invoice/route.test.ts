import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generatePeppolInvoiceXml,
  PEPPOL_BIS_BILLING_COMPLIANCE_NOTE,
} from '@/lib/peppol-ubl-invoice';
import {
  generateReceiptBlob,
  resolveReceiptLogoDataUri,
} from '@/lib/receipt-pdf-generator';
import { createClient } from '@/lib/supabase/server';
import { GET } from './route';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/peppol-ubl-invoice', () => ({
  generatePeppolInvoiceXml: vi.fn(() => '<Invoice />'),
  PEPPOL_BIS_BILLING_COMPLIANCE_NOTE:
    'This invoice complies with Peppol BIS Billing 3.0 through a generated UBL XML invoice artifact created from this order.',
}));

vi.mock('@/lib/receipt-pdf-generator', () => ({
  generateReceiptBlob: vi.fn(),
  resolveReceiptLogoDataUri: vi.fn(() => Promise.resolve(null)),
}));

const ORDER_ID = 'cfa945fc-9bf4-4485-857c-4d4374adf31f';
type QueryResult = {
  data: unknown;
  error: unknown;
};
const orderResult: QueryResult = {
  data: {
    id: ORDER_ID,
    order_number: 'ORD-1001',
    created_at: '2026-03-22T10:00:00.000Z',
    invoice_issue_date: '2026-04-01T00:00:00.000Z',
    payment_due_date: '2026-04-15T00:00:00.000Z',
    payment_terms: 'Net 14',
    buyer_reference: 'BUYER-REF-001',
    invoice_note: 'Merchant invoice note',
    firs_irn: 'IRN-2026-001',
    firs_csid: 'CSID-2026-001',
    firs_qr_code: null,
    subtotal: 500000,
    tax_amount: 0,
    shipping_fee: 0,
    discount_amount: 0,
    total: 500000,
    currency: 'NGN',
    customer_name: 'Ada Customer',
    customer_email: 'ada@example.com',
    customer_phone: '08012345678',
    shipping_address: null,
    fulfillment_details: {
      imei: 'IMEI-123',
      serial_number: 'SN-456',
    },
    merchants: {
      id: 'merchant-1',
      user_id: 'user-1',
      business_name: 'Test Merchant',
      legal_entity_name: null,
      tax_identification_number: null,
      cac_rc_number: null,
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      registered_address: {
        street: '99 Registered Road',
        city: 'Ikeja',
        state: 'Lagos',
        postal_code: '100001',
        country: 'NG',
      },
      email: 'merchant@example.com',
      phone: '08000000000',
      business_address: '12 Allen Avenue',
      support_email: null,
      support_phone: null,
      logo_url: null,
      brand_colors: null,
      bank_code: null,
      bank_account_number: null,
      bank_name: null,
      bank_account_name: null,
      social_media: null,
      pages: null,
    },
  },
  error: null,
};
const orderItemsResult: QueryResult = {
  data: [
    {
      id: 'item-1',
      line_id: 1,
      name: 'Leather Case',
      item_description: null,
      quantity: 1,
      price: 10000,
      unit_code: 'EA',
      line_extension_amount: 10000,
      vat_category_code: 'S',
      vat_rate: 7.5,
      vat_amount: 0,
      sellers_item_id: null,
      product_id: 'product-case',
    },
    {
      id: 'item-2',
      line_id: 2,
      name: 'iPhone 15 Pro',
      item_description: null,
      quantity: 1,
      price: 490000,
      unit_code: 'EA',
      line_extension_amount: 490000,
      vat_category_code: 'S',
      vat_rate: 7.5,
      vat_amount: 0,
      sellers_item_id: 'SELLER-IPHONE-15',
      product_id: 'product-phone',
    },
  ],
  error: null,
};
const taxSubtotalsResult: QueryResult = { data: [], error: null };
const paymentAccountsResult: QueryResult = {
  data: [
    {
      account_number: '1234567890',
      bank_name: 'Wema Bank',
      account_name: 'OgaBassey-Test',
    },
  ],
  error: null,
};

function createQuery<T>(result: T) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    or: vi.fn(() => query),
    limit: vi.fn().mockResolvedValue(result),
    order: vi.fn(() => query),
    single: vi.fn().mockResolvedValue(result),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaitable.
    then: (resolve: (value: T) => void) =>
      Promise.resolve(result).then(resolve),
  };

  return query;
}

function createSupabaseMock({
  items = orderItemsResult,
  order = orderResult,
  paymentAccounts = paymentAccountsResult,
  taxSubtotals = taxSubtotalsResult,
  user = { id: 'user-1' },
}: {
  items?: QueryResult;
  order?: QueryResult;
  paymentAccounts?: QueryResult;
  taxSubtotals?: QueryResult;
  user?: { id: string } | null;
} = {}) {
  const orderQuery = createQuery(order);
  const itemsQuery = createQuery(items);
  const paymentAccountsQuery = createQuery(paymentAccounts);
  const taxQuery = createQuery(taxSubtotals);
  const from = vi.fn((table: string) => {
    if (table === 'orders') return orderQuery;
    if (table === 'order_items') return itemsQuery;
    if (table === 'order_payment_accounts') return paymentAccountsQuery;
    if (table === 'order_tax_subtotals') return taxQuery;
    return createQuery({ data: null, error: null });
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
      }),
    },
    from,
    queries: {
      paymentAccountsQuery,
    },
  };
}

function createOrderResultWithFulfillment(
  fulfillmentDetails: Record<string, unknown>
): QueryResult {
  return {
    data: {
      ...(orderResult.data as Record<string, unknown>),
      fulfillment_details: fulfillmentDetails,
    },
    error: null,
  };
}

function getGeneratedInvoiceItems() {
  const invoiceData = vi.mocked(generatePeppolInvoiceXml).mock
    .calls[0]?.[0] as {
    items: Array<{ description?: string }>;
  };

  return invoiceData.items;
}

function getGeneratedReceiptItems() {
  const receiptOrder = vi.mocked(generateReceiptBlob).mock.calls[0]?.[0] as {
    items: Array<{
      id?: string | null;
      line_id?: number;
      product_id?: string | null;
    }>;
  };

  return receiptOrder.items;
}

describe('GET /api/orders/[id]/invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn() } as never);
    vi.mocked(generatePeppolInvoiceXml).mockReturnValue('<Invoice />');
    vi.mocked(generateReceiptBlob).mockReturnValue(new Blob(['invoice']));
    vi.mocked(resolveReceiptLogoDataUri).mockResolvedValue(
      'data:image/png;base64,AA=='
    );
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock() as unknown as ReturnType<typeof createClient>
    );
  });

  it('attaches order-level IMEI details only to the device item', async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain(
      'filename="invoice-ORD-1001.pdf"'
    );
    expect(response.headers.get('Content-Disposition')).toContain(
      "filename*=UTF-8''invoice-ORD-1001.pdf"
    );

    const invoiceItems = getGeneratedInvoiceItems();

    expect(invoiceItems[0]?.description).toBeUndefined();
    expect(invoiceItems[1]?.description).toContain('IMEI: IMEI-123');
    expect(invoiceItems[1]?.description).toContain('S/N: SN-456');
    expect(generateReceiptBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        order_number: 'ORD-1001',
        items: expect.arrayContaining([
          expect.objectContaining({
            product_name: 'iPhone 15 Pro',
            description: expect.stringContaining('IMEI: IMEI-123'),
            line_extension_amount: 490000,
            sellers_item_id: 'SELLER-IPHONE-15',
            unit_code: 'EA',
            vat_amount: 0,
            vat_category_code: 'S',
            vat_rate: 7.5,
          }),
        ]),
        virtual_account: expect.objectContaining({
          account_number: '1234567890',
          bank_name: 'Wema Bank',
        }),
      }),
      expect.objectContaining({
        business_name: 'Test Merchant',
        registered_address: expect.objectContaining({
          street: '99 Registered Road',
        }),
      }),
      expect.objectContaining({
        buyerReference: 'BUYER-REF-001',
        complianceNote: PEPPOL_BIS_BILLING_COMPLIANCE_NOTE,
        documentDate: new Date('2026-04-01T00:00:00.000Z'),
        documentKind: 'invoice',
        dueDate: new Date('2026-04-15T00:00:00.000Z'),
        firsCsid: 'CSID-2026-001',
        firsIrn: 'IRN-2026-001',
        invoiceTypeCode: '380',
        invoiceNotes: 'Merchant invoice note',
        logoDataUri: 'data:image/png;base64,AA==',
        paymentTerms: 'Net 14',
        taxSubtotals: expect.any(Array),
      })
    );
  });

  it('falls back to the transaction day when the issue date is null', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        order: {
          data: {
            ...(orderResult.data as Record<string, unknown>),
            invoice_issue_date: null,
            transaction_date: '2026-03-05T10:00:00.000Z',
          },
          error: null,
        },
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);
    const invoiceData = vi.mocked(generatePeppolInvoiceXml).mock
      .calls[0]?.[0] as {
      issue_date: Date;
    };
    // created_at is 2026-03-22 (recording day); the Peppol invoice must
    // carry the Mar 5 transaction day instead.
    expect(invoiceData.issue_date).toEqual(
      new Date('2026-03-05T10:00:00.000Z')
    );
  });

  it('attaches order-level fulfillment items to their matching invoice lines', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        order: createOrderResultWithFulfillment({
          items: [
            {
              imei: '111111111111111',
              orderItemId: 'item-1',
              productName: 'Leather Case',
            },
            {
              orderItemId: 'item-2',
              productName: 'iPhone 15 Pro',
              serialNumber: 'IPHONE-SERIAL-2',
            },
          ],
        }),
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);

    const invoiceItems = getGeneratedInvoiceItems();

    expect(invoiceItems[0]?.description).toContain('IMEI: 111111111111111');
    expect(invoiceItems[0]?.description).not.toContain('IPHONE-SERIAL-2');
    expect(invoiceItems[1]?.description).toContain('S/N: IPHONE-SERIAL-2');
    expect(invoiceItems[1]?.description).not.toContain('111111111111111');
    expect(getGeneratedReceiptItems()).toMatchObject([
      { id: 'item-1', line_id: 1, product_id: 'product-case' },
      { id: 'item-2', line_id: 2, product_id: 'product-phone' },
    ]);
  });

  it('includes the assurance premium in BT-109/BT-112 when stored tax totals are product-only', async () => {
    const orderData = orderResult.data as Record<string, unknown>;
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        order: {
          data: {
            ...orderData,
            subtotal: 103000,
            shipping_fee: 0,
            discount_amount: 0,
            tax_amount: 0,
            total: 103000,
            // Storefront RPC stores these from SUM(line_extension) = product
            // only (100,000), excluding the rolled-in 3,000 assurance premium.
            tax_exclusive_amount: 100000,
            tax_inclusive_amount: 100000,
            merchants: {
              ...(orderData.merchants as Record<string, unknown>),
              vat_registration_status: 'not_registered',
              vat_rate: 0,
            },
          },
          error: null,
        },
        items: {
          data: [
            {
              id: 'item-1',
              line_id: 1,
              name: 'iPhone 16',
              item_description: null,
              quantity: 1,
              price: 100000,
              unit_code: 'EA',
              line_extension_amount: 100000,
              vat_category_code: 'O',
              vat_rate: 0,
              vat_amount: 0,
              sellers_item_id: null,
              product_id: 'product-phone',
              assurance_fee: 3000,
            },
          ],
          error: null,
        },
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);
    const invoiceData = vi.mocked(generatePeppolInvoiceXml).mock
      .calls[0]?.[0] as {
      tax_exclusive_amount: number;
      tax_inclusive_amount: number;
      items: Array<{ name: string }>;
    };
    expect(
      invoiceData.items.some((item) => item.name === 'Ogabassey Assurance')
    ).toBe(true);
    expect(invoiceData.tax_exclusive_amount).toBe(103000);
    expect(invoiceData.tax_inclusive_amount).toBe(103000);
  });

  it('generates the invoice with fallback branding when logo resolution fails', async () => {
    vi.mocked(resolveReceiptLogoDataUri).mockRejectedValueOnce(
      new Error('logo fetch failed')
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);
    expect(generateReceiptBlob).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ logoDataUri: null })
    );
  });

  it('preserves zero-rated line tax categories when subtotals are missing', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        items: {
          data: [
            {
              id: 'item-zero-rated',
              line_id: 1,
              name: 'Zero-rated accessory',
              item_description: null,
              quantity: 1,
              price: 10000,
              unit_code: 'EA',
              line_extension_amount: 10000,
              vat_category_code: 'Z',
              vat_rate: 0,
              vat_amount: 0,
              sellers_item_id: null,
              product_id: 'product-zero-rated',
            },
          ],
          error: null,
        },
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(generatePeppolInvoiceXml).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        tax_subtotals: [
          {
            vat_category_code: 'Z',
            vat_rate: 0,
            taxable_amount: 10000,
            tax_amount: 0,
            exemption_reason: undefined,
          },
        ],
      })
    );
  });

  it('uses a stored zero-tax subtotal as line VAT metadata when item rows are sparse', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        items: {
          data: [
            {
              id: 'item-exempt',
              line_id: 1,
              name: 'Exempt accessory',
              item_description: null,
              quantity: 1,
              price: 10000,
              unit_code: 'EA',
              line_extension_amount: 10000,
              vat_category_code: null,
              vat_rate: null,
              vat_amount: null,
              sellers_item_id: null,
              product_id: 'product-exempt',
            },
          ],
          error: null,
        },
        taxSubtotals: {
          data: [
            {
              vat_category_code: 'E',
              vat_rate: 0,
              taxable_amount: 10000,
              tax_amount: 0,
              exemption_reason: 'VAT exempt',
            },
          ],
          error: null,
        },
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(generatePeppolInvoiceXml).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            vat_category_code: 'E',
            vat_rate: 0,
            vat_amount: 0,
          }),
        ],
        tax_subtotals: [
          {
            vat_category_code: 'E',
            vat_rate: 0,
            taxable_amount: 10000,
            tax_amount: 0,
            exemption_reason: 'VAT exempt',
          },
        ],
      })
    );
  });

  it('allocates positive order tax when stored line VAT is missing or zero', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        order: {
          data: {
            ...(orderResult.data as Record<string, unknown>),
            subtotal: 10000,
            tax_amount: 750,
            total: 10750,
          },
          error: null,
        },
        items: {
          data: [
            {
              id: 'item-taxable',
              line_id: 1,
              name: 'Taxable accessory',
              item_description: null,
              quantity: 1,
              price: 10000,
              unit_code: 'EA',
              line_extension_amount: 10000,
              vat_category_code: 'S',
              vat_rate: 7.5,
              vat_amount: 0,
              sellers_item_id: null,
              product_id: 'product-taxable',
            },
          ],
          error: null,
        },
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(generatePeppolInvoiceXml).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            vat_category_code: 'S',
            vat_rate: 7.5,
            vat_amount: 750,
          }),
        ],
        tax_subtotals: [
          {
            vat_category_code: 'S',
            vat_rate: 7.5,
            taxable_amount: 10000,
            tax_amount: 750,
            exemption_reason: undefined,
          },
        ],
      })
    );
  });

  it('allocates fallback order tax only across positive-rate taxable lines', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        order: {
          data: {
            ...(orderResult.data as Record<string, unknown>),
            subtotal: 20000,
            tax_amount: 750,
            total: 20750,
          },
          error: null,
        },
        items: {
          data: [
            {
              id: 'item-taxable',
              line_id: 1,
              name: 'Taxable accessory',
              item_description: null,
              quantity: 1,
              price: 10000,
              unit_code: 'EA',
              line_extension_amount: 10000,
              vat_category_code: 'S',
              vat_rate: 7.5,
              vat_amount: 0,
              sellers_item_id: null,
              product_id: 'product-taxable',
            },
            {
              id: 'item-zero-rated',
              line_id: 2,
              name: 'Zero-rated accessory',
              item_description: null,
              quantity: 1,
              price: 10000,
              unit_code: 'EA',
              line_extension_amount: 10000,
              vat_category_code: 'Z',
              vat_rate: 0,
              vat_amount: 0,
              sellers_item_id: null,
              product_id: 'product-zero-rated',
            },
          ],
          error: null,
        },
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(generatePeppolInvoiceXml).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            vat_category_code: 'S',
            vat_rate: 7.5,
            vat_amount: 750,
          }),
          expect.objectContaining({
            vat_category_code: 'Z',
            vat_rate: 0,
            vat_amount: 0,
          }),
        ],
      })
    );
  });

  it('preserves stored zero line extension amounts instead of falling back to price', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        order: {
          data: {
            ...(orderResult.data as Record<string, unknown>),
            subtotal: 0,
            tax_amount: 750,
            total: 750,
          },
          error: null,
        },
        items: {
          data: [
            {
              id: 'item-zero-total',
              line_id: 1,
              name: 'Zero line total accessory',
              item_description: null,
              quantity: 1,
              price: 10000,
              unit_code: 'EA',
              line_extension_amount: 0,
              vat_category_code: 'S',
              vat_rate: 7.5,
              vat_amount: 0,
              sellers_item_id: null,
              product_id: 'product-zero-total',
            },
          ],
          error: null,
        },
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(generatePeppolInvoiceXml).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            line_extension_amount: 0,
            vat_amount: 0,
          }),
        ],
      })
    );
  });

  it('falls back to merchant bank details when no order payment account exists', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        order: {
          ...orderResult,
          data: {
            ...(orderResult.data as Record<string, unknown>),
            merchants: {
              ...((orderResult.data as Record<string, unknown>)
                .merchants as Record<string, unknown>),
              bank_account_name: 'Merchant Settlement',
              bank_account_number: '9988776655',
              bank_name: 'Fallback Bank',
            },
          },
        },
        paymentAccounts: { data: [], error: null },
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);
    expect(generateReceiptBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        virtual_account: null,
      }),
      expect.objectContaining({
        bank_account_name: 'Merchant Settlement',
        bank_account_number: '9988776655',
        bank_name: 'Fallback Bank',
      }),
      expect.any(Object)
    );
  });

  it('keeps null-expiry Paystack DVAs valid regardless of creation time', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        paymentAccounts: {
          data: [
            {
              account_number: '2222333344',
              bank_name: 'Paystack-Titan',
              account_name: 'Old Valid DVA',
              created_at: '2026-01-01T00:00:00.000Z',
              expires_at: null,
              provider: 'paystack',
            },
          ],
          error: null,
        },
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);
    expect(generateReceiptBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        virtual_account: expect.objectContaining({
          account_name: 'Old Valid DVA',
          account_number: '2222333344',
          bank_name: 'Paystack-Titan',
        }),
      }),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('passes stored credit-note type codes into the branded renderer', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        order: {
          ...orderResult,
          data: {
            ...(orderResult.data as Record<string, unknown>),
            invoice_type_code: '381',
          },
        },
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(generateReceiptBlob).mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        invoiceTypeCode: '381',
      })
    );
  });

  it('skips Peppol artifacts for unpaid invoice proforma documents', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        order: {
          ...orderResult,
          data: {
            ...(orderResult.data as Record<string, unknown>),
            payment_method: 'invoice',
            payment_status: 'unpaid',
            invoice_type_code: '380',
          },
        },
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);
    expect(generatePeppolInvoiceXml).not.toHaveBeenCalled();
    expect(vi.mocked(generateReceiptBlob).mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        complianceNote: undefined,
        documentKind: 'proforma_invoice',
        invoiceTypeCode: '325',
      })
    );
    expect(response.headers.get('Content-Disposition')).toContain(
      'filename="proforma-ORD-1001.pdf"'
    );
    expect(response.headers.get('Content-Disposition')).toContain(
      "filename*=UTF-8''proforma-ORD-1001.pdf"
    );
  });

  it('returns 500 when the order payment account lookup fails', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        paymentAccounts: {
          data: null,
          error: { message: 'database unavailable' },
        },
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'Failed to load invoice payment account',
      code: 'PAYMENT_ACCOUNT_LOOKUP_FAILED',
    });
    expect(generateReceiptBlob).not.toHaveBeenCalled();
  });

  it('attaches order-level IMEI details to the first item when no device item exists', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        items: {
          data: [
            {
              id: 'item-1',
              line_id: 1,
              name: 'Leather Case',
              item_description: null,
              quantity: 1,
              price: 10000,
              unit_code: 'EA',
              line_extension_amount: 10000,
              vat_category_code: 'S',
              vat_rate: 7.5,
              vat_amount: 0,
              sellers_item_id: null,
              product_id: 'product-case',
            },
            {
              id: 'item-2',
              line_id: 2,
              name: 'Screen Protector',
              item_description: null,
              quantity: 1,
              price: 5000,
              unit_code: 'EA',
              line_extension_amount: 5000,
              vat_category_code: 'S',
              vat_rate: 7.5,
              vat_amount: 0,
              sellers_item_id: null,
              product_id: 'product-protector',
            },
          ],
          error: null,
        },
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);

    const invoiceItems = getGeneratedInvoiceItems();

    expect(invoiceItems[0]?.description).toContain('IMEI: IMEI-123');
    expect(invoiceItems[0]?.description).toContain('S/N: SN-456');
    expect(invoiceItems[1]?.description).toBeUndefined();
  });

  it('attaches camelCase serialNumber fulfillment details to the device item', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        order: createOrderResultWithFulfillment({
          imei: 'IMEI-789',
          serialNumber: 'SN-CAMEL',
        }),
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);

    const invoiceItems = getGeneratedInvoiceItems();

    expect(invoiceItems[0]?.description).toBeUndefined();
    expect(invoiceItems[1]?.description).toContain('IMEI: IMEI-789');
    expect(invoiceItems[1]?.description).toContain('S/N: SN-CAMEL');
  });

  it('attaches IMEI-only fulfillment details without adding a serial label', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        order: createOrderResultWithFulfillment({
          imei: 'IMEI-ONLY',
          serial_number: null,
        }),
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);

    const invoiceItems = getGeneratedInvoiceItems();

    expect(invoiceItems[1]?.description).toContain('IMEI: IMEI-ONLY');
    expect(invoiceItems[1]?.description).not.toContain('S/N:');
  });

  it('attaches serial-only fulfillment details without adding an IMEI label', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        order: createOrderResultWithFulfillment({
          imei: null,
          serial_number: 'SN-ONLY',
        }),
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);

    const invoiceItems = getGeneratedInvoiceItems();

    expect(invoiceItems[1]?.description).toContain('S/N: SN-ONLY');
    expect(invoiceItems[1]?.description).not.toContain('IMEI:');
  });

  it('returns 401 when the merchant user is not authenticated', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({ user: null }) as unknown as ReturnType<
        typeof createClient
      >
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(401);
    expect(generateReceiptBlob).not.toHaveBeenCalled();
  });

  it('authenticates before validating malformed order ids', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({ user: null }) as unknown as ReturnType<
        typeof createClient
      >
    );

    const response = await GET(
      new NextRequest('http://localhost/api/orders/not-a-uuid/invoice'),
      { params: Promise.resolve({ id: 'not-a-uuid' }) }
    );

    expect(response.status).toBe(401);
    expect(generateReceiptBlob).not.toHaveBeenCalled();
  });

  it('returns 400 when the order id is invalid', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/orders/not-a-uuid/invoice'),
      { params: Promise.resolve({ id: 'not-a-uuid' }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid order ID',
      code: 'INVALID_ID',
    });
    expect(generateReceiptBlob).not.toHaveBeenCalled();
  });

  it('returns 404 when the order lookup does not find a merchant-owned order', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        order: {
          data: null,
          error: { message: 'Order not found' },
        },
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(404);
    expect(generateReceiptBlob).not.toHaveBeenCalled();
  });

  it('returns 500 when order items cannot be loaded', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock({
        items: {
          data: null,
          error: { message: 'Database error' },
        },
      }) as unknown as ReturnType<typeof createClient>
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(500);
    expect(generateReceiptBlob).not.toHaveBeenCalled();
  });
});

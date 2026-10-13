import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateReceiptBlob,
  resolveReceiptLogoDataUri,
} from '@/lib/receipt-pdf-generator';
import { createClient } from '@/lib/supabase/server';
import { GET } from './route';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/peppol-ubl-invoice', () => ({
  generatePeppolInvoiceXml: vi.fn(() => '<Invoice />'),
  PEPPOL_BIS_BILLING_COMPLIANCE_NOTE: 'Peppol invoice',
}));
vi.mock('@/lib/receipt-pdf-generator', () => ({
  generateReceiptBlob: vi.fn(),
  resolveReceiptLogoDataUri: vi.fn(() => Promise.resolve(null)),
}));

const ORDER_ID = 'cfa945fc-9bf4-4485-857c-4d4374adf31f';
type QueryResult = { data: unknown; error: unknown };

const baseOrder = {
  id: ORDER_ID,
  order_number: 'ORD-1001',
  created_at: '2026-08-27T10:00:00.000Z',
  payment_status: 'pending',
  payment_method: 'paystack',
  total: 10000,
  subtotal: 10000,
  amount_paid: 0,
  currency: 'NGN',
  customer_name: 'Buyer',
  customer_email: 'buyer@example.com',
  customer_phone: null,
  shipping_address: null,
  fulfillment_details: null,
  tax_amount: 0,
  shipping_fee: 0,
  discount_amount: 0,
  is_credit_order: false,
  merchants: {
    id: 'merchant-1',
    user_id: 'user-1',
    business_name: 'Merchant',
    vat_registration_status: 'unregistered',
    vat_rate: null,
  },
};

const itemResult: QueryResult = {
  data: [
    {
      id: 'item-1',
      line_id: 1,
      name: 'Product',
      item_description: null,
      quantity: 1,
      price: 10000,
      unit_code: 'EA',
      line_extension_amount: 10000,
      vat_category_code: null,
      vat_rate: null,
      vat_amount: null,
      sellers_item_id: null,
      product_id: 'product-1',
    },
  ],
  error: null,
};

function createQuery(result: QueryResult) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaitable.
    then: (resolve: (value: QueryResult) => void) =>
      Promise.resolve(result).then(resolve),
  };
  return query;
}

function createSupabaseMock(
  paymentAccounts: QueryResult,
  orderPatch: Record<string, unknown> = {}
) {
  const orderQuery = createQuery({
    data: { ...baseOrder, ...orderPatch },
    error: null,
  });
  const itemsQuery = createQuery(itemResult);
  const taxQuery = createQuery({ data: [], error: null });
  const paymentAccountsQuery = createQuery(paymentAccounts);
  const from = vi.fn((table: string) => {
    if (table === 'orders') return orderQuery;
    if (table === 'order_items') return itemsQuery;
    if (table === 'order_tax_subtotals') return taxQuery;
    if (table === 'order_payment_accounts') return paymentAccountsQuery;
    return createQuery({ data: null, error: null });
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    from,
    paymentAccountsQuery,
  };
}

function invoiceRequest() {
  return GET(
    new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
    {
      params: Promise.resolve({ id: ORDER_ID }),
    }
  );
}

describe('invoice Paystack payment-account history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn() } as never);
    vi.mocked(generateReceiptBlob).mockReturnValue(new Blob(['invoice']));
    vi.mocked(resolveReceiptLogoDataUri).mockResolvedValue(null);
  });

  it('keeps an expired Paystack DVA on a paid invoice for payment history', async () => {
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock(
        {
          data: [
            {
              account_number: '2222333344',
              bank_name: 'Paystack-Titan',
              account_name: 'Historical DVA',
              assigned_at: '2026-03-22T10:00:00.000Z',
              created_at: '2026-03-22T10:00:00.000Z',
              expires_at: '2026-03-22T11:30:00.000Z',
              provider: 'paystack',
            },
          ],
          error: null,
        },
        { payment_status: 'paid' }
      ) as unknown as ReturnType<typeof createClient>
    );

    const response = await invoiceRequest();

    expect(response.status).toBe(200);
    expect(generateReceiptBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        virtual_account: expect.objectContaining({
          account_name: 'Historical DVA',
          account_number: '2222333344',
          bank_name: 'Paystack-Titan',
        }),
      }),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('does not print an unpaid Paystack DVA before its assignment starts', async () => {
    const supabase = createSupabaseMock({
      data: [
        {
          account_number: '2222333344',
          bank_name: 'Paystack-Titan',
          account_name: 'Future DVA',
          assigned_at: '2099-03-22T10:00:00.000Z',
          created_at: '2099-03-22T10:00:00.000Z',
          expires_at: '2099-03-22T11:30:00.000Z',
          provider: 'paystack',
        },
      ],
      error: null,
    });
    vi.mocked(createClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createClient>
    );

    const response = await invoiceRequest();

    expect(response.status).toBe(200);
    expect(generateReceiptBlob).toHaveBeenCalledWith(
      expect.objectContaining({ virtual_account: null }),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('does not include a legacy-untrusted Paystack DVA on the invoice', async () => {
    const supabase = createSupabaseMock({
      data: [
        {
          account_number: '2222333344',
          bank_name: 'Paystack-Titan',
          account_name: 'Legacy DVA',
          assignment_customer_email_source: 'legacy_untrusted',
          created_at: '2026-08-24T10:00:00.000Z',
          expires_at: '2026-09-07T10:00:00.000Z',
          provider: 'paystack',
        },
      ],
      error: null,
    });
    vi.mocked(createClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createClient>
    );

    const response = await invoiceRequest();

    expect(response.status).toBe(200);
    expect(supabase.paymentAccountsQuery.or).toHaveBeenCalledWith(
      'assignment_customer_email_source.is.null,assignment_customer_email_source.neq.legacy_untrusted'
    );
    expect(generateReceiptBlob).toHaveBeenCalledWith(
      expect.objectContaining({ virtual_account: null }),
      expect.any(Object),
      expect.any(Object)
    );
  });
});

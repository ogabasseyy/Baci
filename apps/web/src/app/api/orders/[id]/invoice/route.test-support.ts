import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { vi } from 'vitest';
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

export const invoiceTestSupport = {
  cookies,
  NextRequest,
  generatePeppolInvoiceXml,
  PEPPOL_BIS_BILLING_COMPLIANCE_NOTE,
  generateReceiptBlob,
  resolveReceiptLogoDataUri,
  createClient,
  GET,
  ORDER_ID,
  orderResult,
  orderItemsResult,
  taxSubtotalsResult,
  paymentAccountsResult,
  createQuery,
  createSupabaseMock,
  createOrderResultWithFulfillment,
  getGeneratedInvoiceItems,
  getGeneratedReceiptItems,
};

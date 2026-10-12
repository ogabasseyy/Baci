import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type SupabaseMockResult = Promise<{ data: unknown; error: unknown }>;

const mockOrderSingle = jest.fn<() => SupabaseMockResult>();
const mockTransactionsRpc =
  jest.fn<(fn: string, args: unknown) => SupabaseMockResult>();

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (operation: () => Promise<unknown>) => operation(),
}));

jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_SLUG: 'ogabassey' },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn() }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      if (fn === 'get_customer_order_transactions') {
        return mockTransactionsRpc(fn, args);
      }
      return Promise.resolve({ data: [], error: null });
    },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ eq: () => ({ single: mockOrderSingle }) }) }),
      }),
    }),
  },
}));

jest.mock('@/hooks/use-merchant-receipt-info', () => ({
  useMerchantReceiptInfo: () => ({ data: null }),
}));

import { receiptDetailQueryOptions } from './use-receipts';

const scope = { merchantId: 'merchant-1', userId: 'user-1' };

describe('receipt detail covered-manual transaction failures', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fails closed when a covered-manual transaction lookup fails', async () => {
    // A covered manual balance promotes to a receipt dated from its
    // transactions: swallowing the lookup error would render a misdated
    // receipt, so the whole detail load must fail like a paid order.
    const error = new Error('customer transaction lookup failed');
    mockOrderSingle.mockResolvedValue({
      data: {
        payment_status: 'pending',
        shipping_status: 'processing',
        recorded_by_user_id: 'staff-1',
        import_job_id: null,
        external_source: null,
        total: 500,
        subtotal: 500,
        shipping_fee: 0,
        tax_amount: 0,
        discount_amount: 0,
        amount_paid: 500,
        currency: 'NGN',
        order_items: [{ id: 'item-1', name: 'Phone', quantity: 1, price: 500 }],
      },
      error: null,
    });
    mockTransactionsRpc.mockResolvedValue({ data: null, error });

    await expect(
      receiptDetailQueryOptions('order-1', scope).queryFn()
    ).rejects.toBe(error);
  });

  it('fails closed on transaction lookup failures for uncovered manual invoices', async () => {
    // Uncovered invoices (zero payment progress) still render their
    // settled payments: the aggregate need not reconcile with the
    // ledger, so a failed lookup fails closed like any progress
    // instead of resolving an empty history.
    mockOrderSingle.mockResolvedValue({
      data: {
        id: 'order-1',
        order_number: 'ORD-1',
        payment_status: 'pending',
        payment_method: 'paystack',
        recorded_by_user_id: 'staff-1',
        import_job_id: null,
        external_source: null,
        total: 500,
        subtotal: 500,
        shipping_fee: 0,
        tax_amount: 0,
        discount_amount: 0,
        amount_paid: 0,
        currency: 'NGN',
        is_credit_order: false,
        created_at: '2026-09-30T09:00:00.000Z',
        notes: null,
        customer_name: 'Buyer',
        customer_email: 'buyer@example.com',
        customer_phone: null,
        shipping_address: null,
        order_items: [{ id: 'item-1', name: 'Phone', quantity: 1, price: 500 }],
      },
      error: null,
    });
    const error = new Error('customer transaction lookup failed');
    mockTransactionsRpc.mockResolvedValue({ data: null, error });

    await expect(
      receiptDetailQueryOptions('order-1', scope).queryFn()
    ).rejects.toBe(error);
  });

  it('fails closed when the detail row fails schema validation', async () => {
    // A schema-invalid row (missing identity/money fields) must resolve
    // null instead of rendering unvalidated money/dates in the preview.
    mockOrderSingle.mockResolvedValue({
      data: {
        payment_status: 'pending',
        recorded_by_user_id: 'staff-1',
        import_job_id: null,
        external_source: null,
        total: 500,
        amount_paid: 0,
      },
      error: null,
    });
    mockTransactionsRpc.mockResolvedValue({ data: [], error: null });

    const detail = await receiptDetailQueryOptions('order-1', scope).queryFn();
    expect(detail).toBeNull();
  });

  it.each([
    ['cancelled', { shipping_status: 'cancelled' }],
    ['unknown-status', { payment_status: 'on_hold' }],
    ['content-invalid', { order_items: [] }],
    [
      'paid-but-cancelled',
      { payment_status: 'paid', shipping_status: 'cancelled' },
    ],
    ['paid-but-uncovered', { payment_status: 'paid', amount_paid: 100 }],
  ])('tolerates transaction lookup failures for invoice-preview %s rows', async (_label, override) => {
    // Fail-closed dating follows the preview promotion gate: a covered
    // row that previews as an invoice resolves with empty history like
    // any unpaid row instead of blocking the preview.
    mockOrderSingle.mockResolvedValue({
      data: {
        id: 'order-1',
        order_number: 'ORD-1',
        payment_status: 'pending',
        payment_method: 'paystack',
        shipping_status: 'processing',
        recorded_by_user_id: 'staff-1',
        import_job_id: null,
        external_source: null,
        is_credit_order: false,
        created_at: '2026-09-30T09:00:00.000Z',
        notes: null,
        customer_name: 'Buyer',
        customer_email: 'buyer@example.com',
        customer_phone: null,
        shipping_address: null,
        total: 500,
        subtotal: 500,
        shipping_fee: 0,
        tax_amount: 0,
        discount_amount: 0,
        amount_paid: 500,
        currency: 'NGN',
        order_items: [{ id: 'item-1', name: 'Phone', quantity: 1, price: 500 }],
        ...override,
      },
      error: null,
    });
    mockTransactionsRpc.mockResolvedValue({
      data: null,
      error: new Error('customer transaction lookup failed'),
    });

    const detail = await receiptDetailQueryOptions('order-1', scope).queryFn();
    expect(detail?.transactions).toEqual([]);
  });
});

const invoiceRow = {
  id: 'order-1',
  order_number: 'ORD-1',
  payment_status: 'pending',
  payment_method: 'paystack',
  recorded_by_user_id: 'staff-1',
  import_job_id: null,
  external_source: null,
  total: 500,
  subtotal: 500,
  shipping_fee: 0,
  tax_amount: 0,
  discount_amount: 0,
  amount_paid: 0,
  currency: 'NGN',
  is_credit_order: false,
  created_at: '2026-09-30T09:00:00.000Z',
  notes: null,
  customer_name: 'Buyer',
  customer_email: 'buyer@example.com',
  customer_phone: null,
  shipping_address: null,
  order_items: [{ id: 'item-1', name: 'Phone', quantity: 1, price: 500 }],
};

describe('receipt detail invoice terms and addresses', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes invoice terms/notes/FIRS selected for the preview', async () => {
    mockOrderSingle.mockResolvedValue({
      data: {
        ...invoiceRow,
        invoice_note: 'Priority',
        payment_due_date: '2026-05-20',
        payment_terms: 'Net 30',
        buyer_reference: 'PO-77',
        firs_irn: 'IRN-1',
        firs_csid: 'CSID-2',
      },
      error: null,
    });
    mockTransactionsRpc.mockResolvedValue({ data: [], error: null });

    const detail = await receiptDetailQueryOptions('order-1', scope).queryFn();
    expect(detail?.invoice_note).toBe('Priority');
    expect(detail?.payment_terms).toBe('Net 30');
  });

  it('accepts explicit null address keys from the mobile-admin path', async () => {
    mockOrderSingle.mockResolvedValue({
      data: {
        ...invoiceRow,
        shipping_address: {
          address_line1: null,
          address_line2: null,
          city: null,
          country: null,
        },
      },
      error: null,
    });
    mockTransactionsRpc.mockResolvedValue({ data: [], error: null });

    const detail = await receiptDetailQueryOptions('order-1', scope).queryFn();
    expect(detail).not.toBeNull();
  });
});

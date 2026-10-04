import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

export const merchantFixture = {
  id: 'merchant-1',
  slug: 'ogabassey',
  business_name: 'Ogabassey',
  email: 'hello@ogabassey.com',
  support_email: 'support@ogabassey.com',
  email_sender_name: null,
  logo_url: null,
  email_logo_url: null,
  brand_colors: null,
  phone: null,
  support_phone: null,
  business_address: 'Ikeja, Lagos',
  registered_address: null,
  cac_rc_number: null,
  tax_identification_number: null,
  legal_entity_name: null,
  vat_registration_status: null,
  vat_rate: null,
  bank_code: null,
  bank_account_number: null,
  bank_name: null,
  bank_account_name: null,
};
export const orderFixture = {
  id: 'order-1',
  merchant_id: 'merchant-1',
  customer_id: 'customer-1',
  recorded_by_user_id: 'staff-1',
  import_job_id: null,
  external_source: null,
  order_number: 'ORD-42',
  created_at: '2026-09-30T09:00:00Z',
  transaction_date: '2026-09-28T09:00:00Z',
  invoice_issue_date: '2026-09-26',
  payment_due_date: null,
  payment_terms: null,
  buyer_reference: null,
  firs_irn: null,
  firs_csid: null,
  currency: 'NGN',
  total: 950000,
  subtotal: 950000,
  tax_amount: 0,
  shipping_fee: 0,
  discount_amount: 0,
  amount_paid: 950000,
  payment_status: 'paid',
  payment_method: 'bank_transfer',
  invoice_type_code: null,
  shipping_status: 'pending',
  customer_name: 'Ada',
  customer_email: 'ada@example.com',
  customer_phone: null,
  shipping_address: null,
  fulfillment_details: null,
  order_items: [
    {
      id: 'item-1',
      name: 'Pixel 10 Pro XL',
      quantity: 1,
      price: 950000,
      condition: 'new',
      variant_name: '256GB',
      item_description: 'Sealed box, 2-year warranty',
    },
  ],
};

export function database(
  orderOverride: Record<string, unknown> = {},
  options: {
    claimMarkerError?: boolean;
    claimMarkerThrows?: boolean;
    merchantOverride?: Record<string, unknown>;
    paymentAccounts?: Record<string, unknown>[];
    primaryDomain?: string | null;
    dispatchStatus?: string;
    paymentHistory?: Record<string, unknown>[];
    taxSubtotals?: Record<string, unknown>[];
    dispatchLeaseReset?: boolean;
    dispatchLeaseError?: boolean;
    snapshotError?: { message: string } | null;
    snapshotNull?: boolean;
    claimResult?: { data: unknown; error: unknown } | null;
  } = {}
) {
  const filters: Record<string, unknown> = {};
  const updates: { table: string; values: Record<string, unknown> }[] = [];
  // Models the RPC-committed dispatch marker: once marked, a second
  // conditional write filtered by dispatch_started_at IS NULL matches zero
  // rows, so the suite fails if the sender ever re-adds one.
  let dispatchMarked = false;
  const effectiveOrder = { ...orderFixture, ...orderOverride };
  const client = {
    rpc: vi.fn().mockImplementation((fn: string) => {
      // Claim-bound dispatch snapshot: composed from the same fixtures
      // the table mocks below serve, so every existing case exercises
      // the RPC path unchanged.
      if (fn === 'get_manual_order_document_snapshot') {
        if (options.snapshotError)
          return Promise.resolve({ data: null, error: options.snapshotError });
        if (options.snapshotNull)
          return Promise.resolve({ data: null, error: null });
        return Promise.resolve({
          data: {
            order: { ...orderFixture, ...orderOverride },
            merchant: { ...merchantFixture, ...options.merchantOverride },
            tax_subtotals: options.taxSubtotals ?? [],
            transactions: options.paymentHistory ?? [],
            payment_accounts: options.paymentAccounts ?? [],
            claim_domain: options.primaryDomain ?? null,
          },
          error: null,
        });
      }
      if (fn === 'mark_manual_document_claim_sent') {
        if (options.claimMarkerThrows)
          return Promise.reject(new Error('network lost'));
        if (options.claimMarkerError)
          return Promise.resolve({
            data: null,
            error: { message: 'failed write' },
          });
        return Promise.resolve({ data: 'claim-1', error: null });
      }
      if (fn === 'mark_manual_document_dispatch_started') {
        const status = options.dispatchStatus ?? 'marked';
        if (status === 'marked') dispatchMarked = true;
        return Promise.resolve({ data: { status }, error: null });
      }
      if (options.claimResult !== undefined && options.claimResult !== null)
        return Promise.resolve(options.claimResult);
      return Promise.resolve({
        data: {
          status: 'created',
          claim_id: 'claim-1',
          customer_id: 'customer-1',
          customer_email: 'ada@example.com',
          order_total: effectiveOrder.total,
          order_amount_paid: effectiveOrder.amount_paid,
          order_item_count: effectiveOrder.order_items.length,
          order_payment_status: effectiveOrder.payment_status,
        },
        error: null,
      });
    }),
    from: vi.fn((table: string) => {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn((key: string, value: unknown) => {
          filters[`${table}.${key}`] = value;
          return builder;
        }),
        is: vi.fn((key: string, value: unknown) => {
          filters[`${table}.${key}`] = value;
          return builder;
        }),
        match: vi.fn(() => builder),
        update: vi.fn((values: Record<string, unknown>) => {
          updates.push({ table, values });
          return builder;
        }),
        in: vi.fn((key: string, value: unknown) => {
          filters[`${table}.${key}`] = value;
          return builder;
        }),
        or: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        // biome-ignore lint/suspicious/noThenProperty: mock mirrors thenable supabase builder.
        then: vi.fn((resolve: (value: unknown) => void) =>
          resolve({ data: [], error: null })
        ),
        maybeSingle: vi.fn(() => {
          if (
            table === 'order_notification_outbox' &&
            dispatchMarked &&
            filters['order_notification_outbox.dispatch_started_at'] === null
          )
            return Promise.resolve({ data: null, error: null });
          // Only the lease path touches tables now (the worker owns its
          // queue): every document read rides the snapshot RPC above.
          return Promise.resolve({
            data:
              table === 'order_notification_outbox'
                ? {
                    id: 'outbox-1',
                    dispatch_started_at: options.dispatchLeaseReset
                      ? null
                      : '2026-09-30T10:00:00Z',
                  }
                : { id: 'outbox-1' },
            error:
              table === 'order_notification_outbox' &&
              options.dispatchLeaseError
                ? { message: 'lease read failed' }
                : null,
          });
        }),
      };
      return builder;
    }),
  };
  return {
    client: client as unknown as SupabaseClient,
    rpc: client.rpc,
    filters,
    updates,
  };
}
export const row = {
  id: 'outbox-1',
  claim_owner: 'worker-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
  event_type: 'manual_order_receipt' as const,
};

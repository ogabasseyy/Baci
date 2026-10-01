import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

const merchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
  custom_domain: 'ogabassey.com',
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
const order = {
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
  currency: 'NGN',
  total: 950000,
  subtotal: 950000,
  tax_amount: 0,
  shipping_fee: 0,
  discount_amount: 0,
  amount_paid: 950000,
  payment_status: 'paid',
  payment_method: 'bank_transfer',
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
    },
  ],
};

export function database(
  orderOverride: Record<string, unknown> = {},
  options: {
    claimMarkerError?: boolean;
    claimMarkerThrows?: boolean;
    dispatchMissing?: boolean;
    merchantOverride?: Record<string, unknown>;
  } = {}
) {
  const filters: Record<string, unknown> = {};
  const client = {
    rpc: vi.fn().mockResolvedValue({
      data: {
        status: 'created',
        claim_id: 'claim-1',
        customer_id: 'customer-1',
        customer_email: 'ada@example.com',
      },
      error: null,
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
        update: vi.fn(() => builder),
        maybeSingle: vi.fn(() => {
          if (table === 'receipt_claims' && options.claimMarkerThrows)
            return Promise.reject(new Error('network lost'));
          return Promise.resolve({
            data:
              table === 'orders'
                ? { ...order, ...orderOverride }
                : table === 'merchants'
                  ? { ...merchant, ...options.merchantOverride }
                  : table === 'receipt_claims'
                    ? { id: 'claim-1' }
                    : options.dispatchMissing
                      ? null
                      : { id: 'outbox-1' },
            error:
              table === 'receipt_claims' && options.claimMarkerError
                ? { message: 'failed write' }
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
  };
}
export const row = {
  id: 'outbox-1',
  claim_owner: 'worker-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
  event_type: 'manual_order_receipt' as const,
};

// Shared fixtures for the reconcile-paystack-dva executor tests. Each test
// file keeps its own vi.mock setup; these builders hold no module mocks.
import { vi } from 'vitest';
import type { RichOrder } from '@/scripts/reconcile-paystack-dva-executors';

export function richOrder(overrides: Partial<RichOrder> = {}): RichOrder {
  return {
    id: 'order-1',
    merchant_id: 'merchant-1',
    payment_status: 'paid',
    tax_basis: 'exclusive',
    subtotal: 1000,
    shipping_fee: 50,
    gift_wrapping_fee: 0,
    tax_amount: 75,
    discount_amount: 0,
    total: 1125,
    customer_email: 'buyer@example.com',
    customer_name: 'Buyer Name',
    customer_id: 'cust-1',
    customer_phone: '+2348000000000',
    order_number: 'ORD-1',
    shipping_address: { address: '1 Lekki', city: 'Lagos', state: 'Lagos' },
    order_items: [],
    ...overrides,
  };
}

export const merchantDetails = {
  business_name: 'Ogabassey',
  slug: 'ogabassey',
  support_email: 'support@ogabassey.com',
  email_sender_name: 'Ogabassey',
  email: 'support@ogabassey.com',
  tax_identification_number: null,
  cac_rc_number: null,
};

export const defaultArgs = () => ({
  // Supabase mock: rpc is the only method actually called by settlementExecutor
  supabase: {
    rpc: vi.fn().mockResolvedValue({ error: null }),
  } as never,
  richOrder: richOrder(),
  order: {
    id: 'order-1',
    merchant_id: 'merchant-1',
    payment_status: 'paid' as const,
    tax_basis: 'exclusive' as const,
    subtotal: 1000,
    shipping_fee: 50,
    gift_wrapping_fee: 0,
    tax_amount: 75,
    discount_amount: 0,
    total: 1125,
  },
  transaction: {
    id: 'txn-1',
    order_id: 'order-1',
    merchant_id: 'merchant-1',
    gateway_reference: 'BAC-XYZ',
    amount: 1125,
  },
  paystackReference: '100000000',
  merchantDetails,
  merchantFetchError: null as unknown,
  rawPlatformFee: 25,
  actor: 'script:test',
});

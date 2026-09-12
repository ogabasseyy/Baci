// Test-only fixtures for finalize-order-gateway-payment.test.ts. The
// `-fixtures` suffix keeps this file out of Vitest's test glob and the
// production bundle (same convention as reconcile-paystack-dva-fixtures.ts).
import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';
import type { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';

export const richOrderRow = {
  ad_tracking: null,
  cancelled_at: null,
  currency: 'NGN',
  customer_email: 'daniel@example.com',
  customer_id: 'cust-1',
  customer_name: 'Daniel Agboli',
  customer_phone: '+2347000000000',
  discount_amount: 0,
  gift_wrapping_fee: 0,
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_items: [],
  order_number: 'ORD-260711-00NT-5',
  payment_status: 'paid',
  shipping_address: { address: '1 Road', city: 'Lagos', state: 'LA' },
  shipping_fee: 0,
  shipping_status: 'processing',
  subtotal: 58290.6,
  tax_amount: 0,
  tax_basis: null,
  total: 58290.6,
  updated_at: '2026-07-11T17:25:10Z',
};

export const transaction = {
  amount: 58290.6,
  gateway_reference: '100004260711172450165090811595',
  id: 'txn-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
  platform_fee: 1165.81,
};

export function buildSupabase(
  orderResult: {
    data?: unknown;
    error?: unknown;
  },
  options: { outboxError?: unknown; outboxRows?: unknown[] } = {}
) {
  const single = vi
    .fn()
    .mockResolvedValue({ data: null, error: null, ...orderResult });
  // The pure-replay guard checks payment_side_effects via
  // .select().eq().limit(); default to existing outbox history so replay
  // tests exercise the drain path.
  // Rows carry the PAYER transaction id: the finalizer uses it to tell a
  // replay of the paying transaction from a capture that landed on an order
  // already paid elsewhere.
  const limit = vi.fn().mockResolvedValue({
    data: options.outboxError
      ? null
      : (options.outboxRows ?? [
          { order_id: 'order-1', transaction_id: 'txn-1' },
        ]),
    error: options.outboxError ?? null,
  });
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: { payment_method: 'paystack' }, error: null });
  const eq = vi.fn().mockReturnValue({ limit, maybeSingle, single });
  const select = vi.fn().mockReturnValue({ eq });
  const deleteChain: Record<string, unknown> = { error: null };
  deleteChain.eq = vi.fn(() => deleteChain);
  deleteChain.delete = vi.fn(() => deleteChain);
  return {
    from: vi.fn().mockReturnValue({ ...deleteChain, select }),
  } as unknown as SupabaseClient;
}

export function baseArgs(
  supabase: SupabaseClient,
  overrides: Partial<Parameters<typeof finalizeOrderGatewayPayment>[0]> = {}
) {
  return {
    actor: 'webhook:REF',
    gateway: 'paystack' as const,
    gatewayResponse: { status: 'success' },
    orderId: 'order-1',
    reference: 'REF',
    scheduleAfter: (task: () => Promise<void>) => {
      void task();
    },
    supabase,
    transaction,
    wonTransactionFlip: true,
    ...overrides,
  };
}

export function completion(overrides: Record<string, unknown> = {}) {
  return {
    completion: {
      already_completed: false,
      order_already_paid: false,
      order_cancelled: false,
      order_updated: true,
      previous_payment_status: 'pending',
      previous_shipping_status: 'pending',
      ...overrides,
    },
    ok: true as const,
  };
}

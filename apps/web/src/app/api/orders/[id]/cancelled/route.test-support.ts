import type { NextRequest } from 'next/server';
import { vi } from 'vitest';

export function request(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

export function createSupabase() {
  const orderItemsEq = vi.fn().mockResolvedValue({
    data: [{ product_id: 'product-1' }],
    error: null,
  });
  const orderItemsOrderEq = vi.fn(() => ({ eq: orderItemsEq }));
  const variantsIn = vi.fn().mockResolvedValue({ data: [], error: null });
  const persistedMode = vi.fn().mockResolvedValue({
    data: {
      amount_paid: 5000,
      cancellation_refund_mode: 'automatic',
      currency: 'NGN',
      payment_status: 'paid',
      total: 5000,
    },
    error: null,
  });
  const ledgerRows = vi.fn().mockResolvedValue({
    data: [
      {
        amount: 5000,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: 'ref-1',
        id: 'leg-1',
        payment_transaction_id: null,
        status: 'completed',
        transaction_type: 'payment',
      },
    ],
    error: null,
  });
  const productsIn = vi.fn().mockResolvedValue({
    data: [{ id: 'product-1', manage_stock: true, slug: 'phone' }],
    error: null,
  });
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'order_items') {
        return {
          select: vi.fn(() => ({
            eq: orderItemsOrderEq,
          })),
        };
      }
      if (table === 'orders') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({ maybeSingle: persistedMode })),
            })),
          })),
        };
      }
      if (table === 'transactions') {
        const chain: Record<string, unknown> = {};
        chain.eq = vi.fn(() => chain);
        chain.in = ledgerRows;
        return { select: vi.fn(() => chain) };
      }
      if (table === 'products') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ in: productsIn })),
          })),
        };
      }
      if (table === 'product_variants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ in: variantsIn })),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
    rpc: vi.fn(
      (name: string): Promise<{ data: unknown; error: unknown }> =>
        Promise.resolve(
          name === 'order_has_unresolved_refund_evidence'
            ? { data: false, error: null }
            : { data: true, error: null }
        )
    ),
  };
  return {
    orderItemsEq,
    orderItemsOrderEq,
    ledgerRows,
    persistedMode,
    productsIn,
    supabase,
    variantsIn,
  };
}

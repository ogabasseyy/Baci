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
  const variantsIn = vi.fn().mockResolvedValue({ data: [], error: null });
  const persistedMode = vi.fn().mockResolvedValue({
    data: { cancellation_refund_mode: 'automatic' },
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
        return { select: vi.fn(() => ({ eq: orderItemsEq })) };
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
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  };
  return {
    orderItemsEq,
    ledgerRows,
    persistedMode,
    productsIn,
    supabase,
    variantsIn,
  };
}

import { NextRequest } from 'next/server';
import { vi } from 'vitest';
import { POST } from './route';

// Shared fixtures for route.test.ts. The vi.mock() calls stay in the test file.
export const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
export const MERCHANT_ID = '22222222-2222-4222-8222-222222222222';

// Per-table chainable mock: products/merchants select/eq return self and
// resolve their own fixture, insert resolves a thenable for the
// negotiation_logs write. Defaults the merchant fixture to an NGN merchant so
// existing callers (that don't care about currency) keep working unchanged.
export function supabaseFor(
  fixture: Record<string, unknown> | null,
  merchant: Record<string, unknown> | null = {
    payout_currency: 'NGN',
    country: 'NG',
  },
  rpcOverride?: { data: unknown; error: unknown }
) {
  const insert = vi.fn(() => Promise.resolve({ error: null }));

  // The shopper client can no longer read products.cost_price: the fixture's
  // cost is only visible to the stubbed database function below.
  const { cost_price: costPrice, ...product } = fixture ?? {};
  const productRow = fixture ? product : null;
  const productSelect = vi.fn();

  const productChain: Record<string, unknown> = {};
  productChain.select = (columns: string) => {
    productSelect(columns);
    return productChain;
  };
  productChain.eq = () => productChain;
  productChain.single = () =>
    Promise.resolve({
      data: productRow,
      error: productRow ? null : { message: 'not found' },
    });

  // Mirrors get_negotiation_cost_floor_price(): GREATEST(cost * 1.1, price * 0.98)
  const price = Number(product.price);
  const rpc = vi.fn(() =>
    Promise.resolve(
      rpcOverride ?? {
        data: Math.max((Number(costPrice) || price * 0.6) * 1.1, price * 0.98),
        error: null,
      }
    )
  );

  const merchantChain: Record<string, unknown> = {};
  merchantChain.select = () => merchantChain;
  merchantChain.eq = () => merchantChain;
  merchantChain.maybeSingle = () =>
    Promise.resolve({ data: merchant, error: null });

  const logsChain: Record<string, unknown> = { insert };

  const from = (table: string) => {
    if (table === 'products') return productChain;
    if (table === 'merchants') return merchantChain;
    return logsChain;
  };

  return { supabase: { from, rpc }, insert, productSelect, rpc };
}

export async function callNegotiate(
  product: Record<string, unknown> | null,
  offeredPrice: number,
  attemptNumber = 1,
  merchant?: Record<string, unknown> | null,
  rpcOverride?: { data: unknown; error: unknown }
) {
  const { createClient } = await import('@/lib/supabase/server');
  const { supabase, insert, productSelect, rpc } = supabaseFor(
    product,
    merchant,
    rpcOverride
  );
  vi.mocked(createClient).mockReturnValue(supabase as never);
  const request = new NextRequest('http://localhost/api/storefront/negotiate', {
    method: 'POST',
    body: JSON.stringify({
      productId: PRODUCT_ID,
      merchantId: MERCHANT_ID,
      offeredPrice,
      attemptNumber,
    }),
  });
  const response = await POST(request);
  return { response, body: await response.json(), insert, productSelect, rpc };
}

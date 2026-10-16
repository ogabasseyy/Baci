import { describe, expect, it, vi } from 'vitest';
import { hasExistingCheckoutOrder } from './has-existing-checkout-order';

function client(row: { id: string } | null, error: unknown = null) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: row, error })),
  };
  return { from: vi.fn(() => query) };
}

describe('hasExistingCheckoutOrder', () => {
  it('finds an order for the merchant and idempotency key', async () => {
    await expect(
      hasExistingCheckoutOrder({
        adminSupabase: client({ id: 'order-1' }) as never,
        merchantId: 'm1',
        requestIdempotencyKey: 'key-1',
      })
    ).resolves.toBe(true);
  });

  it('reports false when no order exists or the probe fails', async () => {
    await expect(
      hasExistingCheckoutOrder({
        adminSupabase: client(null) as never,
        merchantId: 'm1',
        requestIdempotencyKey: 'key-1',
      })
    ).resolves.toBe(false);
    await expect(
      hasExistingCheckoutOrder({
        adminSupabase: client(null, { message: 'db down' }) as never,
        merchantId: 'm1',
        requestIdempotencyKey: 'key-1',
      })
    ).resolves.toBe(false);
  });
});

import { expect, it, vi } from 'vitest';
import { submitCheckoutOrder } from './submit-checkout-order';

it.each([
  [201, true],
  [200, undefined],
] as const)('marks order status %i as fresh only for a new creation', async (status, expected) => {
  const result = await submitCheckoutOrder({
    resolvedPendingOrder: { reusableOrder: null, clearStoredOrder: false },
    getIdempotencyKey: async () => 'key',
    orderRequest: {} as never,
    paymentMethod: 'oxygen',
    total: 4200,
    onVoucherRejected: vi.fn(),
    onPendingOrderInvalidated: vi.fn(async () => undefined),
    onShippingRateRejected: vi.fn(),
    getOrderErrorMessage: () => 'failed',
    request: vi.fn(async () =>
      new Response(JSON.stringify({ order: { id: 'order' } }), { status })
    ) as unknown as typeof fetch,
  });
  expect(result.freshOrder).toBe(expected);
});
it('does not call an explicitly replayed 201 response fresh', async () => {
  const result = await submitCheckoutOrder({
    resolvedPendingOrder: { reusableOrder: null, clearStoredOrder: false },
    getIdempotencyKey: async () => 'key',
    orderRequest: {} as never,
    paymentMethod: 'oxygen',
    total: 4200,
    onVoucherRejected: vi.fn(),
    onPendingOrderInvalidated: vi.fn(async () => undefined),
    onShippingRateRejected: vi.fn(),
    getOrderErrorMessage: () => 'failed',
    request: vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            order: { id: 'order' },
            idempotency: { replayed: true },
          }),
          { status: 201, headers: { 'x-idempotency-replayed': 'true' } }
        )
    ) as unknown as typeof fetch,
  });
  expect(result.freshOrder).toBeUndefined();
});

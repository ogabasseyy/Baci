import type { commitChatwootCartAdd } from './commit-cart-add';

export const merchantId = '11111111-1111-4111-8111-111111111111';
export const cartId = '22222222-2222-4222-8222-222222222222';
export const principal = {
  allowedOperations: ['add', 'quantity'],
  cartId,
  expiresAt: '2026-11-20T00:00:00.000Z',
  grantId: '33333333-3333-4333-8333-333333333333',
  merchantId,
  principalId: 'buyer-1',
  scope: 'session',
};
export const cart = (
  version: number,
  overrides: Record<string, unknown> = {}
) => ({
  cartId,
  expiresAt: '2026-11-30T00:00:00.000Z',
  lines: [],
  merchantId,
  version,
  ...overrides,
});
export const cartContext = {
  binding: { inboxId: 74, merchantId, origin: 'https://s.example.com' },
  cart: cart(12),
  ok: true,
  principal,
  state: { cartId, cartVersion: 12, merchantId },
} as never;
export const input = {
  cartContext,
  cartVersion: 12,
  operationId: 'add-request-01',
  productSlug: 'phone-13',
  sessionToken: 'signed-session-token',
  variantId: '44444444-4444-4444-8444-444444444444',
};

export async function run(
  commit: typeof commitChatwootCartAdd,
  overrides: Partial<typeof input> = {}
) {
  const response = await commit({ ...input, ...overrides });
  return { body: await response.json(), response };
}

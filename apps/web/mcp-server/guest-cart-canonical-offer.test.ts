import { expect, it, vi } from 'vitest';
import { createGuestCanonicalBridge } from './guest-cart-canonical-bridge';
const endpoint = 'https://ogabassey.com/api/storefront/cart/legacy';
const token = 'a'.repeat(64);
const state = {
  cartId: '11111111-1111-4111-8111-111111111111',
  version: 4,
  expiresAt: '2099-01-01T00:00:00Z',
  lines: [{ productId: '22222222-2222-4222-8222-222222222222', quantity: 2 }],
};


it.each(['read', 'update'] as const)('accepts null offer IDs in canonical %s replies', async (operation) => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    ok: true,
    state: { ...state, lines: [{ ...state.lines[0], offerId: null }] },
  })));
  const bridge = createGuestCanonicalBridge(endpoint, fetcher);
  if (!bridge?.read) throw new Error('Missing current-cart reader');
  const result = operation === 'read'
    ? await bridge.read(token)
    : await bridge.update(token, { product_id: state.lines[0].productId, quantity: 2 });
  expect(result.items).toEqual([{ product_id: state.lines[0].productId, quantity: 2 }]);
});

it('preserves an exact offer ID in the canonical reply', async () => {
  const offerId = '33333333-3333-4333-8333-333333333333';
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    ok: true,
    state: { ...state, lines: [{ ...state.lines[0], offerId }] },
  })));
  const result = await createGuestCanonicalBridge(endpoint, fetcher)?.update(token, {
    product_id: state.lines[0].productId, offer_id: offerId, quantity: 2,
  });
  expect(result?.items).toEqual([{ product_id: state.lines[0].productId, offer_id: offerId, quantity: 2 }]);
});

it.each([42, 'not-a-uuid'])('rejects malformed canonical offer identity %s', async (offerId) => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    ok: true,
    state: { ...state, lines: [{ ...state.lines[0], offerId }] },
  })));
  await expect(createGuestCanonicalBridge(endpoint, fetcher)?.update(token, {
    product_id: state.lines[0].productId, quantity: 2,
  })).rejects.toMatchObject({ code: 'invalid_bridge_reply' });
});

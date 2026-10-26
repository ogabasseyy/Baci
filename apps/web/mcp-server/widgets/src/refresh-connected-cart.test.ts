import { expect, it, vi } from 'vitest';
import { refreshConnectedCart } from './refresh-connected-cart';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const value = { success: true, connection_bound: true, canonical_cart_id: id, version: 2, items: [], cart_url: 'https://ogabassey.com/cart' };
it('fetches a fresh connection-bound snapshot without submitting any write', async () => {
  const call = vi.fn().mockResolvedValue({ structuredContent: value });
  expect((await refreshConnectedCart(call, id)).version).toBe(2);
  expect(call).toHaveBeenCalledWith('get_ogabassey_guest_cart', {});
});
it('rejects another cart or a failed refresh', async () => {
  await expect(refreshConnectedCart(vi.fn().mockResolvedValue({ structuredContent: value }), 'other')).rejects.toThrow();
  await expect(refreshConnectedCart(vi.fn().mockResolvedValue({ structuredContent: { success: false } }), id)).rejects.toThrow();
});

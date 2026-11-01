import type { McpServer } from '@modelcontextprotocol/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import type { GuestCartStoreLike } from './guest-cart-health';
import { registerGuestCartTool } from './guest-cart-tool';

const offerLookup = vi.hoisted(() => vi.fn());
vi.mock('./resolve-mcp-variant-offers', () => ({ resolveMcpVariantOffers: offerLookup }));
const product = '11111111-1111-4111-8111-111111111111';
const offer = '55555555-5555-4555-8555-555555555555';
const token = 'a'.repeat(64);
function setup() {
  let handler: (args: { product_id: string; offer_id: string; quantity: number; cart_token: string }) => Promise<unknown>;
  const update = vi.fn(async (_token: string | undefined, line: { product_id: string; offer_id: string; quantity: number }, validate: (items: unknown[]) => Promise<void>) => {
    await validate([line]);
    return { cart_token: token, items: [line], expires_at: '2099-01-01T00:00:00.000Z' };
  });
  const server = { registerTool: vi.fn((_name: string, _config: unknown, callback: typeof handler) => { handler = callback; }) };
  registerGuestCartTool(server as unknown as McpServer, {
    store: { update } as unknown as GuestCartStoreLike,
    supabase: {} as SupabaseClient,
    getMerchantId: async () => '77777777-7777-4777-8777-777777777777',
    formatPrice: String,
  });
  return { call: (quantity: number) => handler({ product_id: product, offer_id: offer, quantity, cart_token: token }), update };
}
it('allows a live exact offer through the registered positive-quantity path', async () => {
  offerLookup.mockResolvedValue({ offers: [{ offer_id: offer, stock_quantity: 3 }], lookupFailed: false });
  const { call, update } = setup();
  const result = await call(2) as { isError?: boolean };
  expect(result.isError).not.toBe(true);
  expect(offerLookup).toHaveBeenCalledWith(expect.objectContaining({ productId: product, merchantId: '77777777-7777-4777-8777-777777777777' }));
  expect(update).toHaveBeenCalledWith(token, expect.objectContaining({ offer_id: offer }), expect.any(Function));
});
it('rejects an unavailable exact offer before writing', async () => {
  offerLookup.mockResolvedValue({ offers: [{ offer_id: offer, stock_quantity: 1 }], lookupFailed: false });
  const { call } = setup();
  const result = await call(2) as { structuredContent: { success: boolean; product_unavailable?: boolean } };
  expect(result.structuredContent).toMatchObject({ success: false, product_unavailable: true });
});
it('fails closed when offer authority is unavailable', async () => {
  offerLookup.mockResolvedValue({ offers: [], lookupFailed: true });
  const { call } = setup();
  const result = await call(2) as { isError?: boolean; structuredContent: { success: boolean } };
  expect(result.structuredContent.success).toBe(false);
});
it('removes an exact offer even when offer authority is unavailable', async () => {
  offerLookup.mockClear();
  offerLookup.mockRejectedValue(new Error('offline'));
  const { call } = setup();
  const result = await call(0) as { isError?: boolean };
  expect(result.isError).not.toBe(true);
  expect(offerLookup).not.toHaveBeenCalled();
});

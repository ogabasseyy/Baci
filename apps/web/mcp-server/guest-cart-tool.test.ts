import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { registerGuestCartTool } from './guest-cart-tool';
import { GuestCartStore } from './guest-cart-store';
const validate = vi.hoisted(() => vi.fn());
vi.mock('./cart-handoff', () => ({ prepareCartHandoff: validate }));
const id = '11111111-1111-4111-8111-111111111111';
it('saves only validated public products and returns a handoff without exposing the capability in its URL', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guest-tool-'));
  type Args = { product_id: string; quantity: number; cart_token?: string };
  let handler: ((args: Args) => Promise<unknown>) | undefined;
  const registerTool = vi.fn((_name: string, _config: unknown, callback: (args: Args) => Promise<unknown>) => { handler = callback; });
  try {
    registerGuestCartTool({ registerTool } as unknown as McpServer, { store: new GuestCartStore(directory), supabase: {} as SupabaseClient, getMerchantId: async () => 'merchant', formatPrice: String });
    expect(registerTool.mock.calls[0][0]).toBe('update_ogabassey_guest_cart');
    validate.mockResolvedValue({ structuredContent: { success: true } });
    const result = await handler?.({ product_id: id, quantity: 2 }) as { structuredContent: { success: boolean; cart_token: string; cart_url: string; items: unknown[] } };
    expect(result.structuredContent.success).toBe(true);
    expect(result.structuredContent.cart_url).not.toContain(result.structuredContent.cart_token);
    expect(result.structuredContent.items).toEqual([{ product_id: id, quantity: 2 }]);
    validate.mockResolvedValue({ structuredContent: { success: false } });
    const failed = await handler?.({ product_id: id, quantity: 3, cart_token: result.structuredContent.cart_token });
    expect(failed).toMatchObject({ isError: true, structuredContent: { success: false } });
    validate.mockResolvedValue({ structuredContent: { success: true } });
    const retry = await handler?.({ product_id: id, quantity: 2, cart_token: result.structuredContent.cart_token });
    expect(retry).toMatchObject({ structuredContent: { items: [{ product_id: id, quantity: 2 }] } });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it('passes variant selection through instead of returning a generic failure', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guest-tool-selection-'));
  type Args = { product_id: string; quantity: number; cart_token?: string };
  let handler: ((args: Args) => Promise<unknown>) | undefined;
  const registerTool = vi.fn((_name: string, _config: unknown, callback: (args: Args) => Promise<unknown>) => { handler = callback; });
  try {
    registerGuestCartTool({ registerTool } as unknown as McpServer, { store: new GuestCartStore(directory), supabase: {} as SupabaseClient, getMerchantId: async () => 'merchant', formatPrice: String });
    validate.mockResolvedValue({ structuredContent: { success: false, requires_variant_selection: true, product_id: id, product_url: 'https://ogabassey.com/products/slug' } });
    const result = await handler?.({ product_id: id, quantity: 1 }) as { isError?: boolean; structuredContent: Record<string, unknown> };
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ success: false, requires_variant_selection: true, product_id: id, product_url: 'https://ogabassey.com/products/slug' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

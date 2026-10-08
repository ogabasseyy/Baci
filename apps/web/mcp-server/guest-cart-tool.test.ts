import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { registerGuestCartTool } from './guest-cart-tool';
import { GUEST_CART_QUOTA_MAX_CREATIONS as MAX_QUOTA } from './guest-cart-creation-quota';
import { GuestCartStore } from './guest-cart-store';
import { releaseWriterLocks } from './guest-cart-writer-lock';
import { GuestCartStorageUnavailableError } from './guest-cart-writer-lock-errors';
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
  } finally { releaseWriterLocks(); await rm(directory, { recursive: true, force: true }); }
});
it('ignores stale survivors when validating an unrelated add', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guest-tool-survivor-'));
  const survivor = '22222222-2222-4222-8222-222222222222';
  type Args = { product_id: string; quantity: number; cart_token?: string };
  let handler: ((args: Args) => Promise<unknown>) | undefined;
  const registerTool = vi.fn((_name: string, _config: unknown, callback: (args: Args) => Promise<unknown>) => { handler = callback; });
  try {
    registerGuestCartTool({ registerTool } as unknown as McpServer, { store: new GuestCartStore(directory), supabase: {} as SupabaseClient, getMerchantId: async () => 'merchant', formatPrice: String });
    validate.mockResolvedValue({ structuredContent: { success: true } });
    const created = await handler?.({ product_id: survivor, quantity: 1 }) as { structuredContent: { cart_token: string } };
    validate.mockClear();
    validate.mockImplementation(async ({ productId }: { productId: string }) => ({ structuredContent: productId === survivor ? { success: false } : { success: true } }));
    const result = await handler?.({ product_id: id, quantity: 1, cart_token: created.structuredContent.cart_token }) as { structuredContent: { success: boolean; items: unknown[] } };
    expect(result.structuredContent.success).toBe(true);
    expect(result.structuredContent.items).toEqual([{ product_id: survivor, quantity: 1 }, { product_id: id, quantity: 1 }]);
    expect(validate.mock.calls).toHaveLength(1);
    expect(validate.mock.calls[0][0].productId).toBe(id);
  } finally { releaseWriterLocks(); await rm(directory, { recursive: true, force: true }); }
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
  } finally { releaseWriterLocks(); await rm(directory, { recursive: true, force: true }); }
});
it('returns a recoverable flag when the token names a dead cart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guest-tool-expired-'));
  type Args = { product_id: string; quantity: number; cart_token?: string };
  let handler: ((args: Args) => Promise<unknown>) | undefined;
  const registerTool = vi.fn((_name: string, _config: unknown, callback: (args: Args) => Promise<unknown>) => { handler = callback; });
  try {
    registerGuestCartTool({ registerTool } as unknown as McpServer, { store: new GuestCartStore(directory), supabase: {} as SupabaseClient, getMerchantId: async () => 'merchant', formatPrice: String });
    validate.mockClear();
    const result = await handler?.({ product_id: id, quantity: 1, cart_token: '0'.repeat(64) }) as { isError?: boolean; structuredContent: Record<string, unknown> };
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ success: false, cart_expired: true });
    expect(validate).not.toHaveBeenCalled();
  } finally { releaseWriterLocks(); await rm(directory, { recursive: true, force: true }); }
});
it('reports a full cart as a typed recoverable outcome', async () => {
  type Args = { product_id: string; quantity: number; cart_token?: string };
  let handler: ((args: Args) => Promise<unknown>) | undefined;
  const registerTool = vi.fn((_name: string, _config: unknown, callback: (args: Args) => Promise<unknown>) => { handler = callback; });
  const { GuestCartFullError } = await import('./guest-cart-store');
  registerGuestCartTool({ registerTool } as unknown as McpServer, {
    store: {
      update: async () => {
        throw new GuestCartFullError();
      },
      hasToken: async () => true,
    } as unknown as GuestCartStore,
    supabase: {} as SupabaseClient,
    getMerchantId: async () => 'merchant',
    formatPrice: String,
  });
  const result = await handler?.({ product_id: id, quantity: 1 }) as { isError?: boolean; structuredContent: Record<string, unknown> };
  expect(result.isError).toBeUndefined();
  expect(result.structuredContent).toEqual({ success: false, cart_full: true });
});
it('caps anonymous cart creation per caller while token updates stay unlimited', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guest-tool-quota-'));
  type Args = { product_id: string; quantity: number; cart_token?: string };
  let handler: ((args: Args) => Promise<unknown>) | undefined;
  const registerTool = vi.fn((_name: string, _config: unknown, callback: (args: Args) => Promise<unknown>) => { handler = callback; });
  try {
    registerGuestCartTool({ registerTool } as unknown as McpServer, { store: new GuestCartStore(directory), supabase: {} as SupabaseClient, getMerchantId: async () => 'merchant', formatPrice: String, clientIp: 'quota-test-client' });
    validate.mockResolvedValue({ structuredContent: { success: true } });
    // A failed validation burns no quota: the full burst below still fits.
    validate.mockResolvedValueOnce({ structuredContent: { success: false } });
    const failed = await handler?.({ product_id: id, quantity: 1 }) as { isError?: boolean };
    expect(failed.isError).toBe(true);
    let firstToken = '';
    for (let i = 0; i < MAX_QUOTA; i += 1) {
      const created = await handler?.({ product_id: id, quantity: 1 }) as { structuredContent: { success: boolean; cart_token: string } };
      expect(created.structuredContent.success).toBe(true);
      if (i === 0) firstToken = created.structuredContent.cart_token;
    }
    const denied = await handler?.({ product_id: id, quantity: 1 }) as { isError?: boolean; structuredContent: Record<string, unknown> };
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({ success: false, quota_exceeded: true });
    expect(denied.structuredContent.retry_after_seconds).toEqual(expect.any(Number));
    const update = await handler?.({ product_id: id, quantity: 2, cart_token: firstToken }) as { structuredContent: { success: boolean; items: unknown[] } };
    expect(update.structuredContent.success).toBe(true);
    expect(update.structuredContent.items).toEqual([{ product_id: id, quantity: 2 }]);
  } finally { releaseWriterLocks(); await rm(directory, { recursive: true, force: true }); }
});
it('passes product unavailability through instead of returning a generic failure', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guest-tool-unavailable-'));
  type Args = { product_id: string; quantity: number; cart_token?: string };
  let handler: ((args: Args) => Promise<unknown>) | undefined;
  const registerTool = vi.fn((_name: string, _config: unknown, callback: (args: Args) => Promise<unknown>) => { handler = callback; });
  try {
    registerGuestCartTool({ registerTool } as unknown as McpServer, { store: new GuestCartStore(directory), supabase: {} as SupabaseClient, getMerchantId: async () => 'merchant', formatPrice: String });
    validate.mockResolvedValue({ structuredContent: { success: false, product_unavailable: true } });
    const result = await handler?.({ product_id: id, quantity: 1 }) as { isError?: boolean; structuredContent: Record<string, unknown> };
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ success: false, product_unavailable: true, product_id: id });
  } finally { releaseWriterLocks(); await rm(directory, { recursive: true, force: true }); }
});
it('leaves the live cart unchanged when an update fails availability', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guest-tool-stale-'));
  const survivor = '33333333-3333-4333-8333-333333333333';
  type Args = { product_id: string; quantity: number; cart_token?: string };
  let handler: ((args: Args) => Promise<unknown>) | undefined;
  const registerTool = vi.fn((_name: string, _config: unknown, callback: (args: Args) => Promise<unknown>) => { handler = callback; });
  try {
    registerGuestCartTool({ registerTool } as unknown as McpServer, { store: new GuestCartStore(directory), supabase: {} as SupabaseClient, getMerchantId: async () => 'merchant', formatPrice: String });
    validate.mockResolvedValue({ structuredContent: { success: true } });
    const created = await handler?.({ product_id: id, quantity: 2 }) as { structuredContent: { cart_token: string } };
    validate.mockResolvedValue({ structuredContent: { success: false, product_unavailable: true } });
    const failed = await handler?.({ product_id: id, quantity: 5, cart_token: created.structuredContent.cart_token }) as { structuredContent: Record<string, unknown> };
    expect(failed.structuredContent).toMatchObject({ success: false, product_unavailable: true, product_id: id });
    expect(JSON.stringify(failed)).toContain('left unchanged');
    expect(JSON.stringify(failed)).not.toContain('removed');
    validate.mockResolvedValue({ structuredContent: { success: true } });
    const after = await handler?.({ product_id: survivor, quantity: 1, cart_token: created.structuredContent.cart_token }) as { structuredContent: { items: unknown[] } };
    expect(after.structuredContent.items).toEqual([{ product_id: id, quantity: 2 }, { product_id: survivor, quantity: 1 }]);
  } finally { releaseWriterLocks(); await rm(directory, { recursive: true, force: true }); }
});
it('advertises the bare cart page when the last line is removed', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guest-tool-empty-'));
  type Args = { product_id: string; quantity: number; cart_token?: string };
  let handler: ((args: Args) => Promise<unknown>) | undefined;
  const registerTool = vi.fn((_name: string, _config: unknown, callback: (args: Args) => Promise<unknown>) => { handler = callback; });
  try {
    registerGuestCartTool({ registerTool } as unknown as McpServer, { store: new GuestCartStore(directory), supabase: {} as SupabaseClient, getMerchantId: async () => 'merchant', formatPrice: String });
    validate.mockResolvedValue({ structuredContent: { success: true } });
    const created = await handler?.({ product_id: id, quantity: 1 }) as { structuredContent: { cart_token: string } };
    const emptied = await handler?.({ product_id: id, quantity: 0, cart_token: created.structuredContent.cart_token }) as { structuredContent: { success: boolean; cart_url: string; cart_emptied: boolean; items: unknown[] } };
    expect(emptied.structuredContent.success).toBe(true);
    expect(emptied.structuredContent.cart_url).toBe('https://ogabassey.com/cart');
    expect(emptied.structuredContent.cart_emptied).toBe(true);
    expect(emptied.structuredContent.items).toEqual([]);
  } finally { releaseWriterLocks(); await rm(directory, { recursive: true, force: true }); }
});
it('canonicalizes product IDs before availability validation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guest-tool-canon-'));
  type Args = { product_id: string; quantity: number; cart_token?: string };
  let handler: ((args: Args) => Promise<unknown>) | undefined;
  const registerTool = vi.fn((_name: string, _config: unknown, callback: (args: Args) => Promise<unknown>) => { handler = callback; });
  try {
    registerGuestCartTool({ registerTool } as unknown as McpServer, { store: new GuestCartStore(directory), supabase: {} as SupabaseClient, getMerchantId: async () => 'merchant', formatPrice: String });
    validate.mockResolvedValue({ structuredContent: { success: true } });
    validate.mockClear();
    const upper = id.toUpperCase();
    const result = await handler?.({ product_id: upper, quantity: 1 }) as { structuredContent: { success: boolean; items: unknown[] } };
    expect(result.structuredContent.success).toBe(true);
    expect(result.structuredContent.items).toEqual([{ product_id: id, quantity: 1 }]);
    expect(validate.mock.calls).toHaveLength(1);
    expect(validate.mock.calls[0][0].productId).toBe(id);
  } finally { releaseWriterLocks(); await rm(directory, { recursive: true, force: true }); }
});
it('reports degraded storage plainly instead of a generic failure', async () => {
  type Args = { product_id: string; quantity: number; cart_token?: string };
  let handler: ((args: Args) => Promise<unknown>) | undefined;
  const registerTool = vi.fn((_name: string, _config: unknown, callback: (args: Args) => Promise<unknown>) => { handler = callback; });
  registerGuestCartTool({ registerTool } as unknown as McpServer, {
    store: {
      update: async () => { throw new GuestCartStorageUnavailableError('Guest-cart directory is not writable: /x'); },
      hasToken: async () => false,
    },
    supabase: {} as SupabaseClient,
    getMerchantId: async () => 'merchant',
    formatPrice: String,
  });
  validate.mockResolvedValue({ structuredContent: { success: true } });
  const result = await handler?.({ product_id: id, quantity: 1 }) as { isError?: boolean; structuredContent: Record<string, unknown> };
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toEqual({ success: false });
  expect(JSON.stringify(result)).toContain('temporarily unavailable');
  expect(JSON.stringify(result)).not.toContain('product availability');
});
it('removes lines without a merchant lookup during catalog outages', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guest-tool-removal-'));
  type Args = { product_id: string; quantity: number; cart_token?: string };
  let handler: ((args: Args) => Promise<unknown>) | undefined;
  const registerTool = vi.fn((_name: string, _config: unknown, callback: (args: Args) => Promise<unknown>) => { handler = callback; });
  const getMerchantId = vi.fn(async () => 'merchant');
  try {
    registerGuestCartTool({ registerTool } as unknown as McpServer, { store: new GuestCartStore(directory), supabase: {} as SupabaseClient, getMerchantId, formatPrice: String });
    validate.mockResolvedValue({ structuredContent: { success: true } });
    const created = await handler?.({ product_id: id, quantity: 1 }) as { structuredContent: { success: boolean; cart_token: string } };
    expect(created.structuredContent.success).toBe(true);
    getMerchantId.mockRejectedValue(new Error('catalog down'));
    const removed = await handler?.({ product_id: id, quantity: 0, cart_token: created.structuredContent.cart_token }) as { structuredContent: { success: boolean; cart_emptied: boolean } };
    expect(removed.structuredContent.success).toBe(true);
    expect(removed.structuredContent.cart_emptied).toBe(true);
    expect(getMerchantId).toHaveBeenCalledTimes(1);
  } finally { releaseWriterLocks(); await rm(directory, { recursive: true, force: true }); }
});
it('rejects cross-field violations before quota or database work', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guest-tool-shape-'));
  type Args = { product_id: string; quantity: number; cart_token?: string };
  let handler: ((args: Args) => Promise<unknown>) | undefined;
  const registerTool = vi.fn((_name: string, _config: unknown, callback: (args: Args) => Promise<unknown>) => { handler = callback; });
  const getMerchantId = vi.fn(async () => 'merchant');
  try {
    registerGuestCartTool({ registerTool } as unknown as McpServer, { store: new GuestCartStore(directory), supabase: {} as SupabaseClient, getMerchantId, formatPrice: String });
    validate.mockResolvedValue({ structuredContent: { success: true } });
    validate.mockClear();
    const result = await handler?.({ product_id: id, quantity: 0 }) as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('cart_token');
    expect(validate).not.toHaveBeenCalled();
    expect(getMerchantId).not.toHaveBeenCalled();
  } finally { releaseWriterLocks(); await rm(directory, { recursive: true, force: true }); }
});

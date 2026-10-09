import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { registerGuestCartTool } from './guest-cart-tool';
import { GUEST_CART_QUOTA_MAX_CREATIONS as MAX_QUOTA } from './guest-cart-creation-quota';
import { createFakeGuestCartSupabase } from './guest-cart-fake-supabase';
import { GuestCartStore } from './guest-cart-store';
const validate = vi.hoisted(() => vi.fn());
vi.mock('./cart-handoff', () => ({ prepareCartHandoff: validate }));
const id = '11111111-1111-4111-8111-111111111111';
type Args = { product_id: string; quantity: number; cart_token?: string };
function handlerFor(
  store: GuestCartStore,
  extra?: { getMerchantId?: () => Promise<string>; clientIp?: string }
) {
  let handler: ((args: Args) => Promise<unknown>) | undefined;
  const registerTool = vi.fn(
    (
      _name: string,
      _config: unknown,
      callback: (args: Args) => Promise<unknown>
    ) => {
      handler = callback;
    }
  );
  registerGuestCartTool({ registerTool } as unknown as McpServer, {
    store,
    supabase: {} as SupabaseClient,
    getMerchantId: extra?.getMerchantId ?? (async () => 'merchant'),
    formatPrice: String,
    ...(extra?.clientIp ? { clientIp: extra.clientIp } : {}),
  });
  return { registerTool, handler: handler as (args: Args) => Promise<unknown> };
}
it('saves only validated public products and returns a handoff without exposing the capability in its URL', async () => {
  const fake = createFakeGuestCartSupabase();
  const { registerTool, handler } = handlerFor(
    new GuestCartStore(fake.supabase)
  );
  expect(registerTool.mock.calls[0][0]).toBe('update_ogabassey_guest_cart');
  validate.mockResolvedValue({ structuredContent: { success: true } });
  const result = (await handler({ product_id: id, quantity: 2 })) as {
    structuredContent: {
      success: boolean;
      cart_token: string;
      cart_url: string;
      items: unknown[];
    };
  };
  expect(result.structuredContent.success).toBe(true);
  expect(result.structuredContent.cart_url).not.toContain(
    result.structuredContent.cart_token
  );
  expect(result.structuredContent.items).toEqual([
    { product_id: id, quantity: 2 },
  ]);
  validate.mockResolvedValue({ structuredContent: { success: false } });
  const failed = await handler({
    product_id: id,
    quantity: 3,
    cart_token: result.structuredContent.cart_token,
  });
  expect(failed).toMatchObject({
    isError: true,
    structuredContent: { success: false },
  });
  validate.mockResolvedValue({ structuredContent: { success: true } });
  const retry = await handler({
    product_id: id,
    quantity: 2,
    cart_token: result.structuredContent.cart_token,
  });
  expect(retry).toMatchObject({
    structuredContent: { items: [{ product_id: id, quantity: 2 }] },
  });
});
it('ignores stale survivors when validating an unrelated add', async () => {
  const fake = createFakeGuestCartSupabase();
  const survivor = '22222222-2222-4222-8222-222222222222';
  const { handler } = handlerFor(new GuestCartStore(fake.supabase));
  validate.mockResolvedValue({ structuredContent: { success: true } });
  const created = (await handler({ product_id: survivor, quantity: 1 })) as {
    structuredContent: { cart_token: string };
  };
  validate.mockClear();
  validate.mockImplementation(
    async ({ productId }: { productId: string }) => ({
      structuredContent:
        productId === survivor ? { success: false } : { success: true },
    })
  );
  const result = (await handler({
    product_id: id,
    quantity: 1,
    cart_token: created.structuredContent.cart_token,
  })) as { structuredContent: { success: boolean; items: unknown[] } };
  expect(result.structuredContent.success).toBe(true);
  expect(result.structuredContent.items).toEqual([
    { product_id: survivor, quantity: 1 },
    { product_id: id, quantity: 1 },
  ]);
  expect(validate.mock.calls).toHaveLength(1);
  expect(validate.mock.calls[0][0].productId).toBe(id);
});
it('caps anonymous cart creation per caller while token updates stay unlimited', async () => {
  const fake = createFakeGuestCartSupabase();
  const { handler } = handlerFor(new GuestCartStore(fake.supabase), {
    clientIp: 'quota-test-client',
  });
  validate.mockResolvedValue({ structuredContent: { success: true } });
  // A failed validation burns no quota: the full burst below still fits.
  validate.mockResolvedValueOnce({ structuredContent: { success: false } });
  const failed = (await handler({ product_id: id, quantity: 1 })) as {
    isError?: boolean;
  };
  expect(failed.isError).toBe(true);
  let firstToken = '';
  for (let i = 0; i < MAX_QUOTA; i += 1) {
    const created = (await handler({ product_id: id, quantity: 1 })) as {
      structuredContent: { success: boolean; cart_token: string };
    };
    expect(created.structuredContent.success).toBe(true);
    if (i === 0) firstToken = created.structuredContent.cart_token;
  }
  const denied = (await handler({ product_id: id, quantity: 1 })) as {
    isError?: boolean;
    structuredContent: Record<string, unknown>;
  };
  expect(denied.isError).toBe(true);
  expect(denied.structuredContent).toMatchObject({
    success: false,
    quota_exceeded: true,
  });
  expect(denied.structuredContent.retry_after_seconds).toEqual(
    expect.any(Number)
  );
  const update = (await handler({
    product_id: id,
    quantity: 2,
    cart_token: firstToken,
  })) as { structuredContent: { success: boolean; items: unknown[] } };
  expect(update.structuredContent.success).toBe(true);
  expect(update.structuredContent.items).toEqual([
    { product_id: id, quantity: 2 },
  ]);
});
it('advertises the bare cart page when the last line is removed', async () => {
  const fake = createFakeGuestCartSupabase();
  const { handler } = handlerFor(new GuestCartStore(fake.supabase));
  validate.mockResolvedValue({ structuredContent: { success: true } });
  const created = (await handler({ product_id: id, quantity: 1 })) as {
    structuredContent: { cart_token: string };
  };
  const emptied = (await handler({
    product_id: id,
    quantity: 0,
    cart_token: created.structuredContent.cart_token,
  })) as {
    structuredContent: {
      success: boolean;
      cart_url: string;
      cart_emptied: boolean;
      items: unknown[];
    };
  };
  expect(emptied.structuredContent.success).toBe(true);
  expect(emptied.structuredContent.cart_url).toBe('https://ogabassey.com/cart');
  expect(emptied.structuredContent.cart_emptied).toBe(true);
  expect(emptied.structuredContent.items).toEqual([]);
});
it('canonicalizes product IDs before availability validation', async () => {
  const fake = createFakeGuestCartSupabase();
  const { handler } = handlerFor(new GuestCartStore(fake.supabase));
  validate.mockResolvedValue({ structuredContent: { success: true } });
  validate.mockClear();
  const upper = id.toUpperCase();
  const result = (await handler({ product_id: upper, quantity: 1 })) as {
    structuredContent: { success: boolean; items: unknown[] };
  };
  expect(result.structuredContent.success).toBe(true);
  expect(result.structuredContent.items).toEqual([
    { product_id: id, quantity: 1 },
  ]);
  expect(validate.mock.calls).toHaveLength(1);
  expect(validate.mock.calls[0][0].productId).toBe(id);
});
it('removes lines without a merchant lookup during catalog outages', async () => {
  const fake = createFakeGuestCartSupabase();
  const getMerchantId = vi.fn(async () => 'merchant');
  const { handler } = handlerFor(new GuestCartStore(fake.supabase), {
    getMerchantId,
  });
  validate.mockResolvedValue({ structuredContent: { success: true } });
  const created = (await handler({ product_id: id, quantity: 1 })) as {
    structuredContent: { success: boolean; cart_token: string };
  };
  expect(created.structuredContent.success).toBe(true);
  getMerchantId.mockRejectedValue(new Error('catalog down'));
  const removed = (await handler({
    product_id: id,
    quantity: 0,
    cart_token: created.structuredContent.cart_token,
  })) as { structuredContent: { success: boolean; cart_emptied: boolean } };
  expect(removed.structuredContent.success).toBe(true);
  expect(removed.structuredContent.cart_emptied).toBe(true);
  expect(getMerchantId).toHaveBeenCalledTimes(1);
});
it('rejects cross-field violations before quota or database work', async () => {
  const fake = createFakeGuestCartSupabase();
  const getMerchantId = vi.fn(async () => 'merchant');
  const { handler } = handlerFor(new GuestCartStore(fake.supabase), {
    getMerchantId,
  });
  validate.mockResolvedValue({ structuredContent: { success: true } });
  validate.mockClear();
  const result = (await handler({ product_id: id, quantity: 0 })) as {
    isError?: boolean;
  };
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).toContain('cart_token');
  expect(validate).not.toHaveBeenCalled();
  expect(getMerchantId).not.toHaveBeenCalled();
});

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { registerGuestCartTool } from './guest-cart-tool';
import {
  GuestCartFullError,
  GuestCartStorageUnavailableError,
} from './guest-cart-errors';
import { createFakeGuestCartSupabase } from './guest-cart-fake-supabase';
import { reserveGuestCartCreation } from './guest-cart-creation-quota';
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
it('passes variant selection through instead of returning a generic failure', async () => {
  const fake = createFakeGuestCartSupabase();
  const { handler } = handlerFor(new GuestCartStore(fake.supabase));
  validate.mockResolvedValue({
    structuredContent: {
      success: false,
      requires_variant_selection: true,
      product_id: id,
      product_url: 'https://ogabassey.com/products/slug',
    },
  });
  const result = (await handler({ product_id: id, quantity: 1 })) as {
    isError?: boolean;
    structuredContent: Record<string, unknown>;
  };
  expect(result.isError).toBeUndefined();
  expect(result.structuredContent).toMatchObject({
    success: false,
    requires_variant_selection: true,
    product_id: id,
    product_url: 'https://ogabassey.com/products/slug',
  });
});
it('returns a recoverable flag when the token names a dead cart', async () => {
  const fake = createFakeGuestCartSupabase();
  const { handler } = handlerFor(new GuestCartStore(fake.supabase));
  validate.mockClear();
  const result = (await handler({
    product_id: id,
    quantity: 1,
    cart_token: '0'.repeat(64),
  })) as { isError?: boolean; structuredContent: Record<string, unknown> };
  expect(result.isError).toBeUndefined();
  expect(result.structuredContent).toEqual({ success: false, cart_expired: true });
  expect(validate).not.toHaveBeenCalled();
});
it('reports a full cart as a typed recoverable outcome', async () => {
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
  const result = (await handler?.({ product_id: id, quantity: 1 })) as {
    isError?: boolean;
    structuredContent: Record<string, unknown>;
  };
  expect(result.isError).toBeUndefined();
  expect(result.structuredContent).toEqual({ success: false, cart_full: true });
});
it('passes product unavailability through instead of returning a generic failure', async () => {
  const fake = createFakeGuestCartSupabase();
  const { handler } = handlerFor(new GuestCartStore(fake.supabase));
  validate.mockResolvedValue({
    structuredContent: { success: false, product_unavailable: true },
  });
  const result = (await handler({ product_id: id, quantity: 1 })) as {
    isError?: boolean;
    structuredContent: Record<string, unknown>;
  };
  expect(result.isError).toBeUndefined();
  expect(result.structuredContent).toMatchObject({
    success: false,
    product_unavailable: true,
    product_id: id,
  });
});
it('leaves the live cart unchanged when an update fails availability', async () => {
  const fake = createFakeGuestCartSupabase();
  const survivor = '33333333-3333-4333-8333-333333333333';
  const { handler } = handlerFor(new GuestCartStore(fake.supabase));
  validate.mockResolvedValue({ structuredContent: { success: true } });
  const created = (await handler({ product_id: id, quantity: 2 })) as {
    structuredContent: { cart_token: string };
  };
  validate.mockResolvedValue({
    structuredContent: { success: false, product_unavailable: true },
  });
  const failed = (await handler({
    product_id: id,
    quantity: 5,
    cart_token: created.structuredContent.cart_token,
  })) as { structuredContent: Record<string, unknown> };
  expect(failed.structuredContent).toMatchObject({
    success: false,
    product_unavailable: true,
    product_id: id,
  });
  expect(JSON.stringify(failed)).toContain('left unchanged');
  expect(JSON.stringify(failed)).not.toContain('removed');
  validate.mockResolvedValue({ structuredContent: { success: true } });
  const after = (await handler({
    product_id: survivor,
    quantity: 1,
    cart_token: created.structuredContent.cart_token,
  })) as { structuredContent: { items: unknown[] } };
  expect(after.structuredContent.items).toEqual([
    { product_id: id, quantity: 2 },
    { product_id: survivor, quantity: 1 },
  ]);
});
it('reports degraded storage plainly instead of a generic failure', async () => {
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
    store: {
      update: async () => {
        throw new GuestCartStorageUnavailableError(
          'guest cart storage failed (upsert_mcp_guest_cart): db.internal refused'
        );
      },
      hasToken: async () => false,
    },
    supabase: {} as SupabaseClient,
    getMerchantId: async () => 'merchant',
    formatPrice: String,
  });
  validate.mockResolvedValue({ structuredContent: { success: true } });
  const result = (await handler?.({ product_id: id, quantity: 1 })) as {
    isError?: boolean;
    structuredContent: Record<string, unknown>;
  };
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toEqual({ success: false });
  expect(JSON.stringify(result)).toContain('temporarily unavailable');
  expect(JSON.stringify(result)).not.toContain('db.internal');
  expect(JSON.stringify(result)).not.toContain('product availability');
});
it('logs storage outages with the token-free code for ops', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
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
    // The message embeds a token, which must never reach logs.
    const token = 't'.repeat(64);
    registerGuestCartTool({ registerTool } as unknown as McpServer, {
      store: {
        update: async () => {
          throw new GuestCartStorageUnavailableError(
            `upsert failed for ${token}`,
            'XX000'
          );
        },
        hasToken: async () => false,
      },
      supabase: {} as SupabaseClient,
      getMerchantId: async () => 'merchant',
      formatPrice: String,
    });
    validate.mockResolvedValue({ structuredContent: { success: true } });
    await handler?.({ product_id: id, quantity: 1 });
    expect(errorSpy).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'guest-cart',
        event: 'storage_unavailable',
        code: 'XX000',
      })
    );
    expect(errorSpy.mock.calls.map(String).join('\n')).not.toContain(token);
  } finally {
    errorSpy.mockRestore();
  }
});

it('logs quota denials without the caller identity for ops', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const fake = createFakeGuestCartSupabase();
    const { handler: quotaHandler } = handlerFor(
      new GuestCartStore(fake.supabase),
      { clientIp: '198.51.100.7' }
    );
    for (let index = 0; index < 600; index += 1) {
      reserveGuestCartCreation('198.51.100.7');
    }
    const denied = await quotaHandler({ product_id: id, quantity: 1 });
    expect(denied.structuredContent).toMatchObject({
      success: false,
      quota_exceeded: true,
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"quota_exceeded"')
    );
    expect(errorSpy.mock.calls.map(String).join('\n')).not.toContain(
      '198.51.100.7'
    );
  } finally {
    errorSpy.mockRestore();
  }
});

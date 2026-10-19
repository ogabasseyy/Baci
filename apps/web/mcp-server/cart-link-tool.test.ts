import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { registerCartLinkTools } from './cart-link-tool';

const prepare = vi.hoisted(() => vi.fn());
vi.mock('./cart-handoff', () => ({ prepareCartHandoff: prepare }));

beforeEach(() => {
  prepare.mockReset();
});

type Handler = (args: {
  product_id: string;
  quantity?: number;
}) => Promise<unknown>;

function setup() {
  const handlers = new Map<string, Handler>();
  const configs = new Map<string, unknown>();
  const registerTool = vi.fn(
    (name: string, config: unknown, callback: Handler) => {
      handlers.set(name, callback);
      configs.set(name, config);
    }
  );
  registerCartLinkTools({ registerTool } as unknown as McpServer, {
    supabase: {} as SupabaseClient,
    getMerchantId: async () => 'merchant-1',
    formatPrice: String,
  });
  return { handlers, configs };
}

it('registers the tool under both the current and alias names', () => {
  const { handlers, configs } = setup();

  expect([...handlers.keys()].sort()).toEqual([
    'add_to_cart',
    'prepare_storefront_cart_link',
  ]);
  for (const config of configs.values()) {
    expect(config).toMatchObject({
      title: expect.any(String),
      description: expect.any(String),
      inputSchema: expect.any(Object),
    });
  }
});

it('delegates to cart handoff with the resolved merchant', async () => {
  const { handlers } = setup();
  prepare.mockResolvedValue({ structuredContent: { success: true } });

  const result = await handlers.get('prepare_storefront_cart_link')?.({
    product_id: 'prod-1',
    quantity: 2,
  });

  expect(prepare).toHaveBeenCalledWith({
    supabase: {},
    merchantId: 'merchant-1',
    productId: 'prod-1',
    quantity: 2,
    formatPrice: String,
  });
  expect(result).toMatchObject({ structuredContent: { success: true } });
});

it('defaults an omitted quantity to 1', async () => {
  const { handlers } = setup();
  prepare.mockResolvedValue({ structuredContent: { success: true } });

  await handlers.get('add_to_cart')?.({ product_id: 'prod-1' });

  expect(prepare).toHaveBeenCalledWith(
    expect.objectContaining({ quantity: 1 })
  );
});

it('reports store unavailability when the merchant cannot resolve', async () => {
  const handlers = new Map<string, Handler>();
  const registerTool = vi.fn(
    (name: string, _config: unknown, callback: Handler) => {
      handlers.set(name, callback);
    }
  );
  registerCartLinkTools({ registerTool } as unknown as McpServer, {
    supabase: {} as SupabaseClient,
    getMerchantId: async () => null,
    formatPrice: String,
  });

  const result = await handlers.get('prepare_storefront_cart_link')?.({
    product_id: 'prod-1',
  });

  expect(prepare).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    structuredContent: { success: false },
  });
  expect(JSON.stringify(result)).toContain('Store temporarily unavailable');
});

it('falls back to a generic failure when handoff throws', async () => {
  const errorSpy = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  try {
    const { handlers } = setup();
    prepare.mockRejectedValue(new Error('catalog down'));

    const result = await handlers.get('prepare_storefront_cart_link')?.({
      product_id: 'prod-1',
    });

    expect(result).toMatchObject({
      structuredContent: { success: false },
    });
    expect(JSON.stringify(result)).toContain('Unable to prepare cart link');
    expect(errorSpy).toHaveBeenCalled();
  } finally {
    errorSpy.mockRestore();
  }
});

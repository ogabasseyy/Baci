import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { registerCartLinkTools } from './cart-link-tool';
import { prepareCartHandoff } from './cart-handoff';

function availableSimpleProduct() {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(async () => ({
      data: {
        condition: null,
        has_condition_offers: false,
        has_variants: false,
        manage_stock: false,
        name: 'Phone',
        price: 100,
        slug: 'phone',
        stock_quantity: 0,
      },
      error: null,
    })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return {
    from: vi.fn(() => query),
    rpc: vi.fn(),
  } as unknown as SupabaseClient;
}

function registeredDescriptions(): string[] {
  const configs = new Map<string, { description?: unknown }>();
  registerCartLinkTools(
    {
      registerTool: vi.fn((name: string, config: unknown) => {
        configs.set(
          name,
          config as { description?: unknown }
        );
      }),
    } as unknown as McpServer,
    {
      supabase: {} as SupabaseClient,
      getMerchantId: async () => 'merchant-1',
      formatPrice: String,
    }
  );
  return [...configs.values()].map((config) => String(config.description));
}

describe('old handoff compatibility', () => {
  it('keeps the one-time transfer URL free of grant or session material', async () => {
    const result = await prepareCartHandoff({
      supabase: availableSimpleProduct(),
      merchantId: 'merchant-1',
      productId: 'phone-1',
      quantity: 1,
      formatPrice: String,
    });

    const cartUrl = String(
      (result.structuredContent as { cart_url?: unknown } | undefined)?.cart_url
    );
    expect(cartUrl).toBe('https://ogabassey.com/cart?item_id=phone-1&qty=1');
    const params = new URL(cartUrl).searchParams;
    expect([...params.keys()].sort()).toEqual(['item_id', 'qty']);
    expect(JSON.stringify(result)).not.toMatch(
      /token|grant|proof|secret|session|handoff/i
    );
  });

  it('describes the transfer as one-time, distinct from a linked shared cart', () => {
    for (const description of registeredDescriptions()) {
      expect(description).toMatch(/one-time transfer/i);
      expect(description).toMatch(/does not link/i);
    }
  });
});

import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

const mockHydrate = vi.fn();
const client = createClient('https://example.invalid', 'test-key', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: vi
      .fn()
      .mockRejectedValue(new Error('Network forbidden in unit tests')),
  },
});

vi.mock('@/lib/hydrate-public-products', () => ({
  hydrateAndSanitizePublicProducts: (...args: unknown[]) =>
    mockHydrate(...args),
}));

import { hydrateRelatedBlogProductSerializedInventory } from './hydrate-related-blog-product-serialized-inventory';

describe('hydrateRelatedBlogProductSerializedInventory', () => {
  it('keeps an unlimited sibling purchasable beside a depleted strict child', async () => {
    const products = [
      {
        id: 'mixed',
        name: 'Phone',
        slug: 'phone',
        category_slug: 'smartphones',
        manage_stock: false,
        has_variants: true,
        variants: [
          { inventory_tracking_policy: 'serialized_strict', stock_quantity: 0 },
          { inventory_tracking_policy: 'off', stock_quantity: 0 },
        ],
      },
    ];
    mockHydrate.mockResolvedValueOnce(products);
    const result = await hydrateRelatedBlogProductSerializedInventory(
      client,
      'merchant-1',
      products
    );
    expect(result[0]?.has_purchasable_variant).toBe(true);
  });
  it('marks a serialized variant rail purchasable from canonical public units', async () => {
    const products = [
      {
        id: 'product-1',
        name: 'iPad 10',
        slug: 'ipad-10',
        category_slug: 'tablets',
        has_variants: true,
        variants: [
          {
            id: 'variant-1',
            inventory_tracking_policy: 'serialized_strict',
            stock_quantity: 1,
          },
        ],
      },
    ];
    mockHydrate.mockResolvedValue(products);

    const result = await hydrateRelatedBlogProductSerializedInventory(
      client,
      'merchant-1',
      products
    );

    expect(result[0]?.has_purchasable_variant).toBe(true);
    expect(mockHydrate).toHaveBeenCalledWith(client, 'merchant-1', products);
  });

  it('marks a serialized variant rail unavailable when canonical units are zero', async () => {
    const products = [
      {
        id: 'product-2',
        name: 'iPad 10',
        slug: 'ipad-10',
        category_slug: 'tablets',
        has_variants: true,
        variants: [
          {
            id: 'variant-2',
            inventory_tracking_policy: 'serialized_strict',
            stock_quantity: 0,
          },
        ],
      },
    ];
    mockHydrate.mockResolvedValueOnce(products);

    const result = await hydrateRelatedBlogProductSerializedInventory(
      client,
      'merchant-1',
      products
    );

    expect(result[0]?.has_purchasable_variant).toBe(false);
  });
});

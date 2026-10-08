import { describe, expect, it } from 'vitest';
import { normalizeStorefrontProductVariants } from '@/lib/storefront-product-variants';

describe('normalizeStorefrontProductVariants', () => {
  it('normalizes public RPC variant rows into ProductVariant records', () => {
    expect(
      normalizeStorefrontProductVariants(
        [
          {
            id: 'variant-1',
            product_id: 'product-1',
            merchant_id: 'merchant-1',
            condition: 'used',
            attributes: {
              sim_type: ' eSIM Only ',
              storage: '256GB',
            },
            price_override: '129999',
            stock_quantity: 4,
            images: ['https://cdn.example.com/1.png'],
            primary_image: 'https://cdn.example.com/1.png',
            sku: 'SKU-1',
          },
        ],
        {
          merchantId: 'fallback-merchant',
          productId: 'fallback-product',
          parentStock: 0,
        }
      )
    ).toEqual([
      {
        id: 'variant-1',
        product_id: 'product-1',
        merchant_id: 'merchant-1',
        condition: 'used',
        attributes: {
          sim_type: 'eSIM Only',
          storage: '256GB',
        },
        price_override: 129999,
        stock_quantity: 4,
        images: ['https://cdn.example.com/1.png'],
        primary_image: 'https://cdn.example.com/1.png',
        sku: 'SKU-1',
      },
    ]);
  });

  it('fills missing product and merchant ids from the page context', () => {
    expect(
      normalizeStorefrontProductVariants(
        [
          {
            id: 'variant-2',
            attributes: { storage: '128GB' },
            stock_quantity: 1,
          },
        ],
        {
          merchantId: 'merchant-2',
          productId: 'product-2',
          parentStock: 0,
        }
      )
    ).toEqual([
      expect.objectContaining({
        id: 'variant-2',
        merchant_id: 'merchant-2',
        product_id: 'product-2',
      }),
    ]);
  });

  it('inherits parent stock for null quantities instead of leaking invalid numbers', () => {
    expect(
      normalizeStorefrontProductVariants(
        [
          {
            id: 'variant-3',
            attributes: { storage: '512GB' },
            price_override: null,
            stock_quantity: null,
          },
        ],
        {
          merchantId: 'merchant-3',
          productId: 'product-3',
          parentStock: 7,
        }
      )
    ).toEqual([
      expect.objectContaining({
        id: 'variant-3',
        price_override: undefined,
        stock_quantity: 7,
      }),
    ]);
  });

  it('does not expose inactive, archived, deleted, or anchor variants', () => {
    const variants = [
      { id: 'inactive', is_active: false, stock_quantity: 4 },
      { id: 'inactive-status', status: 'inactive', stock_quantity: 4 },
      { id: 'archived', archived_at: '2026-01-01', stock_quantity: 4 },
      { id: 'deleted', deleted_at: '2026-01-01', stock_quantity: 4 },
      { id: 'anchor', is_inventory_anchor: true, stock_quantity: 4 },
      { id: 'sold-out', stock_quantity: 0 },
      { id: 'available', stock_quantity: 2 },
    ];

    const normalizedVariants = normalizeStorefrontProductVariants(variants, {
      merchantId: 'merchant-5',
      productId: 'product-5',
      parentStock: 0,
    });

    expect(normalizedVariants.map((variant) => variant.id)).toEqual([
      'sold-out',
      'available',
    ]);
  });

  it('keeps an explicit zero instead of inheriting parent stock', () => {
    expect(
      normalizeStorefrontProductVariants([{ id: 'zero', stock_quantity: 0 }], {
        merchantId: 'merchant-7',
        productId: 'product-7',
        parentStock: 9,
      })[0]?.stock_quantity
    ).toBe(0);
  });

  it('keeps sold-out variants available to generic selectors', () => {
    const normalizedVariants = normalizeStorefrontProductVariants(
      [{ id: 'untracked', stock_quantity: 0 }],
      { merchantId: 'merchant-6', productId: 'product-6', parentStock: 0 }
    );

    expect(normalizedVariants.map((variant) => variant.id)).toEqual([
      'untracked',
    ]);
  });

  it.each([
    ['new', 'new'],
    ['used', 'used'],
    ['refurbished', 'open_box'],
    ['uk_used', 'used'],
    [undefined, undefined],
    ['unexpected', undefined],
  ] as const)('normalizes condition %s to %s', (inputCondition, expectedCondition) => {
    expect(
      normalizeStorefrontProductVariants(
        [
          {
            id: 'variant-condition',
            attributes: { storage: '128GB' },
            condition: inputCondition,
            stock_quantity: 3,
          },
        ],
        {
          merchantId: 'merchant-4',
          productId: 'product-4',
          parentStock: 0,
        }
      )[0]?.condition
    ).toBe(expectedCondition);
  });
  it('preserves the effective serialized policy projected by the PDP RPC', () => {
    expect(
      normalizeStorefrontProductVariants(
        [
          {
            id: 'strict',
            stock_quantity: 0,
            inventory_tracking_policy: 'serialized_strict',
          },
        ],
        { merchantId: 'merchant', productId: 'product', parentStock: 0 }
      )[0]
    ).toMatchObject({
      inventory_tracking_policy: 'serialized_strict',
      stock_quantity: 0,
    });
  });
});

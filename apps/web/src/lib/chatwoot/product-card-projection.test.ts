import { describe, expect, it } from 'vitest';
import { projectChatwootProductCard } from './product-card-projection';

const merchantId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const variantId = '33333333-3333-4333-8333-333333333333';

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: productId,
    merchant_id: merchantId,
    slug: 'phone-15',
    name: 'Phone 15',
    status: 'active',
    price: 300_000,
    has_variants: false,
    has_condition_offers: false,
    manage_stock: true,
    stock_quantity: 4,
    stock: 4,
    images: ['https://cdn.example.test/phone.jpg'],
    condition: 'used',
    variants_truncated: false,
    product_variants: [],
    ...overrides,
  };
}

function project(value: unknown) {
  return projectChatwootProductCard({
    currency: 'NGN',
    merchantId,
    product: value,
    requestedSlug: 'phone-15',
  });
}

describe('projectChatwootProductCard', () => {
  it('returns only the compact public card fields and canonical price', () => {
    expect(
      project(
        product({
          cost_price: 12,
          fulfillment_fields: { internal: 'value' },
          customer_email: 'private@example.test',
        })
      )
    ).toEqual({
      ok: true,
      product: {
        slug: 'phone-15',
        name: 'Phone 15',
        price: 300_000,
        currency: 'NGN',
        availability: 'in_stock',
        image: 'https://cdn.example.test/phone.jpg',
        condition: 'used',
        variants: [],
      },
    });
  });

  it('uses canonical per-variant price and stock without exposing other fields', () => {
    expect(
      project(
        product({
          has_variants: true,
          product_variants: [
            {
              id: variantId,
              product_id: productId,
              attributes: { storage: '128 GB' },
              price_override: 325_000,
              stock_quantity: 0,
              sku: 'INTERNAL-SKU',
              inventory_tracking_policy: 'off',
            },
          ],
        })
      )
    ).toEqual({ ok: false, code: 'product_unavailable' });
    const result = project(
      product({
        has_variants: true,
        product_variants: [
          {
            id: variantId,
            product_id: productId,
            attributes: { storage: '128 GB' },
            price_override: 325_000,
            stock_quantity: 3,
            sku: 'INTERNAL-SKU',
            inventory_tracking_policy: 'off',
          },
        ],
      })
    );
    expect(result).not.toHaveProperty('product.variants.0.sku');
  });

  it('uses product base price for null overrides and the cheapest purchasable card price', () => {
    const result = project(
      product({
        has_variants: true,
        min_variant_price: 250_000,
        product_variants: [
          {
            id: variantId,
            product_id: productId,
            attributes: { storage: '256GB' },
            price_override: 350_000,
            stock_quantity: 2,
            inventory_tracking_policy: 'off',
          },
          {
            id: '55555555-5555-4555-8555-555555555555',
            product_id: productId,
            attributes: { storage: '128GB', sim_type: 'Physical + eSIM' },
            price_override: null,
            stock_quantity: 1,
            condition: 'new',
            inventory_tracking_policy: 'off',
            internal_cost: 1,
          },
        ],
      })
    );

    expect(result).toMatchObject({
      ok: true,
      product: {
        price: 300_000,
        variants: [
          {
            price: 350_000,
            attributes: { storage: '256GB' },
          },
          {
            price: 300_000,
            attributes: { storage: '128GB', 'sim type': 'Physical + eSIM' },
            condition: 'new',
          },
        ],
      },
    });
    expect(result).not.toHaveProperty('product.variants.1.internal_cost');
  });

  it('does not advertise a base price when every variant is unavailable', () => {
    expect(
      project(
        product({
          has_variants: true,
          price: 300_000,
          product_variants: [
            {
              id: variantId,
              product_id: productId,
              attributes: { storage: '128GB' },
              price_override: 325_000,
              stock_quantity: 0,
            },
          ],
        })
      )
    ).toEqual({ ok: false, code: 'product_unavailable' });
  });

  it('keeps the condition axis distinct when otherwise identical variants are new and used', () => {
    const result = project(
      product({
        has_variants: true,
        product_variants: [
          {
            id: variantId,
            product_id: productId,
            attributes: { storage: '128GB' },
            condition: 'new',
            stock_quantity: 1,
          },
          {
            id: '55555555-5555-4555-8555-555555555555',
            product_id: productId,
            attributes: { storage: '128GB' },
            condition: 'used',
            stock_quantity: 1,
          },
        ],
      })
    );

    expect(result).toMatchObject({
      ok: true,
      product: {
        variants: [
          {
            condition: 'new',
            attributes: { storage: '128GB' },
          },
          { condition: 'used', attributes: { storage: '128GB' } },
        ],
      },
    });
    expect(result).not.toHaveProperty('product.condition');
  });

  it('rejects an unrecognized explicit variant condition instead of inheriting the product condition', () => {
    expect(
      project(
        product({
          has_variants: true,
          condition: 'used',
          product_variants: [
            {
              id: variantId,
              product_id: productId,
              attributes: { storage: '128GB' },
              condition: 'premium_used',
              stock_quantity: 1,
            },
          ],
        })
      )
    ).toEqual({ ok: false, code: 'product_unavailable' });
  });

  it('returns the canonical slug from case-insensitive PDP resolution', () => {
    const result = projectChatwootProductCard({
      currency: 'NGN',
      merchantId,
      product: product(),
      requestedSlug: 'PHONE-15',
    });
    expect(result).toMatchObject({
      ok: true,
      product: { slug: 'phone-15', currency: 'NGN' },
    });
  });

  it('omits unknown option keys but rejects selections that become ambiguous', () => {
    const distinct = project(
      product({
        has_variants: true,
        product_variants: [
          {
            id: variantId,
            product_id: productId,
            attributes: { storage: '128GB', merchant_note: 'first' },
            stock_quantity: 2,
          },
          {
            id: '55555555-5555-4555-8555-555555555555',
            product_id: productId,
            attributes: { storage: '256GB', merchant_note: 'second' },
            stock_quantity: 2,
          },
        ],
      })
    );
    expect(distinct).toMatchObject({
      ok: true,
      product: {
        variants: [
          { attributes: { storage: '128GB' } },
          { attributes: { storage: '256GB' } },
        ],
      },
    });

    const ambiguous = project(
      product({
        has_variants: true,
        product_variants: [
          {
            id: variantId,
            product_id: productId,
            attributes: { merchant_note: 'first' },
            stock_quantity: 2,
          },
          {
            id: '55555555-5555-4555-8555-555555555555',
            product_id: productId,
            attributes: { merchant_note: 'second' },
            stock_quantity: 2,
          },
        ],
      })
    );
    expect(ambiguous).toEqual({ ok: false, code: 'product_unavailable' });
  });

  it('fails closed for another merchant, condition offers, or truncated variants', () => {
    expect(
      project(product({ merchant_id: '44444444-4444-4444-8444-444444444444' }))
    ).toEqual({
      ok: false,
      code: 'product_unavailable',
    });
    expect(project(product({ has_condition_offers: true }))).toEqual({
      ok: false,
      code: 'unsupported_condition_offers',
    });
    expect(
      project(
        product({
          has_variants: true,
          variants_truncated: true,
          product_variants: [],
        })
      )
    ).toEqual({ ok: false, code: 'product_unavailable' });
  });

  it('fails closed when the canonical variant model is missing or malformed', () => {
    expect(project(product({ has_variants: undefined }))).toEqual({
      ok: false,
      code: 'product_unavailable',
    });
    expect(project(product({ has_variants: 'false' }))).toEqual({
      ok: false,
      code: 'product_unavailable',
    });
    expect(project(product({ has_variants: null }))).toEqual({
      ok: false,
      code: 'product_unavailable',
    });
  });

  it('drops unsafe image URLs and rejects malformed variant options', () => {
    const unsafeImage = project(product({ images: ['javascript:alert(1)'] }));
    expect(unsafeImage.ok && unsafeImage.product).not.toHaveProperty('image');
    expect(
      project(
        product({
          has_variants: true,
          product_variants: [
            {
              id: variantId,
              product_id: productId,
              attributes: { storage: 128 },
              price_override: 325_000,
              stock_quantity: 3,
            },
          ],
        })
      )
    ).toEqual({ ok: false, code: 'product_unavailable' });
  });
});

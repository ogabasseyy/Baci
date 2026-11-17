import { describe, expect, it } from 'vitest';
import {
  product,
  productId,
  project,
  variantId,
} from './product-card-projection.test-support';

describe('projectChatwootProductCard pricing', () => {
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
  it('fails closed when the snapshot marks a simple product variant list as truncated', () => {
    expect(project(product({ variants_truncated: true }))).toEqual({
      ok: false,
      code: 'product_unavailable',
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
    ).toMatchObject({
      ok: true,
      product: {
        availability: 'out_of_stock',
        variants: [{ availability: 'out_of_stock' }],
      },
    });
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
  it('honors explicit variant purchasability and stock signals from the snapshot', () => {
    const result = project(
      product({
        has_variants: true,
        product_variants: [
          {
            id: variantId,
            product_id: productId,
            attributes: { storage: '128GB' },
            price_override: 325_000,
            stock_quantity: 3,
            is_purchasable: false,
          },
        ],
      })
    );
    expect(result).toMatchObject({
      ok: true,
      product: {
        availability: 'out_of_stock',
        variants: [{ availability: 'out_of_stock' }],
      },
    });

    const outOfStockOverride = project(
      product({
        has_variants: true,
        product_variants: [
          {
            id: variantId,
            product_id: productId,
            attributes: { storage: '128GB' },
            price_override: 325_000,
            in_stock: false,
          },
        ],
      })
    );
    expect(outOfStockOverride).toMatchObject({
      ok: true,
      product: {
        availability: 'out_of_stock',
        variants: [{ availability: 'out_of_stock' }],
      },
    });
  });
  it('rejects price strings instead of coercing them into numbers', () => {
    expect(project(product({ price: '300000' }))).toEqual({
      ok: false,
      code: 'product_unavailable',
    });
    expect(
      project(
        product({
          has_variants: true,
          product_variants: [
            {
              id: variantId,
              product_id: productId,
              attributes: { storage: '128GB' },
              price_override: '325000',
              stock_quantity: 2,
            },
          ],
        })
      )
    ).toEqual({ ok: false, code: 'product_unavailable' });
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
            attributes: { storage: '128GB', sim_type: 'Physical + eSIM' },
            condition: 'new',
          },
        ],
      },
    });
    expect(result).not.toHaveProperty('product.variants.1.internal_cost');
  });
  it('returns an out-of-stock card with a listed variant price when none are purchasable', () => {
    const result = project(
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
          {
            id: '55555555-5555-4555-8555-555555555555',
            product_id: productId,
            attributes: { storage: '256GB' },
            price_override: 350_000,
            stock_quantity: 0,
          },
        ],
      })
    );

    expect(result).toMatchObject({
      ok: true,
      product: {
        price: 325_000,
        availability: 'out_of_stock',
        variants: [
          { price: 325_000, availability: 'out_of_stock' },
          { price: 350_000, availability: 'out_of_stock' },
        ],
      },
    });
  });
});

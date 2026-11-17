import { describe, expect, it } from 'vitest';
import {
  product,
  productId,
  project,
  variantId,
} from './product-card-projection.test-support';

describe('projectChatwootProductCard safety', () => {
  it('rejects collisions after normalizing recognized attribute keys', () => {
    expect(
      project(
        product({
          has_variants: true,
          product_variants: [
            {
              id: variantId,
              product_id: productId,
              attributes: { storage: '128GB', Storage: '256GB' },
              stock_quantity: 2,
            },
          ],
        })
      )
    ).toEqual({ ok: false, code: 'product_unavailable' });
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

describe('bugfix: catalog-valid products are not rejected', () => {
  it('projects a 200 character product name with a truncated card name', () => {
    const result = project(product({ name: 'n'.repeat(200) }));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.product.name).toHaveLength(120);
  });

  it('treats an sku_matrix product with a stale false has_variants flag as variant-bearing', () => {
    const result = project(
      product({
        has_variants: false,
        variant_model: 'sku_matrix',
        product_variants: [
          {
            id: variantId,
            product_id: productId,
            attributes: { storage: '128GB' },
            stock_quantity: 2,
          },
        ],
      })
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.product.variants).toHaveLength(1);
  });
});

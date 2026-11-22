import { describe, expect, it } from 'vitest';
import { projectChatwootProductCard } from './product-card-projection';
import {
  merchantId,
  product,
  productId,
  project,
  variantId,
} from './product-card-projection.test-support';

describe('projectChatwootProductCard variants', () => {
  it('uses the selected variant’s public photo and discards invalid URLs', () => {
    const result = project(
      product({
        has_variants: true,
        product_variants: [
          {
            id: variantId,
            product_id: productId,
            attributes: { color: 'Blue' },
            primary_image: 'https://cdn.example.com/blue.avif',
            stock_quantity: 1,
          },
          {
            id: '55555555-5555-4555-8555-555555555555',
            product_id: productId,
            attributes: { color: 'Green' },
            primary_image: 'http://cdn.example.com/green.avif',
            images: [{ url: 'https://cdn.example.com/green.avif' }],
            stock_quantity: 1,
          },
        ],
      })
    );
    expect(result).toMatchObject({
      ok: true,
      product: {
        variants: [
          { image: 'https://cdn.example.com/blue.avif' },
          { image: 'https://cdn.example.com/green.avif' },
        ],
      },
    });
  });

  it('rejects a variant family with an empty variant array', () => {
    expect(
      project(
        product({
          has_variants: true,
          product_variants: [],
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
  it('rejects duplicate selections when variant attribute keys arrive in a different order', () => {
    expect(
      project(
        product({
          has_variants: true,
          product_variants: [
            {
              id: variantId,
              product_id: productId,
              attributes: { storage: '128GB', color: 'Blue' },
              stock_quantity: 1,
            },
            {
              id: '55555555-5555-4555-8555-555555555555',
              product_id: productId,
              attributes: { color: 'Blue', storage: '128GB' },
              stock_quantity: 1,
            },
          ],
        })
      )
    ).toEqual({ ok: false, code: 'product_unavailable' });
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
  it.each([
    '',
    '   ',
  ])('treats blank variant condition %j as absent and inherits the product condition', (condition) => {
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
              condition,
              stock_quantity: 1,
            },
          ],
        })
      )
    ).toMatchObject({
      ok: true,
      product: {
        condition: 'used',
        variants: [{ condition: 'used' }],
      },
    });
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
  it('omits display-only option keys but rejects selections that become ambiguous', () => {
    const distinct = project(
      product({
        has_variants: true,
        product_variants: [
          {
            id: variantId,
            product_id: productId,
            attributes: { storage: '128GB', note: 'first' },
            stock_quantity: 2,
          },
          {
            id: '55555555-5555-4555-8555-555555555555',
            product_id: productId,
            attributes: { storage: '256GB', note: 'second' },
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
            attributes: { note: 'first' },
            stock_quantity: 2,
          },
          {
            id: '55555555-5555-4555-8555-555555555555',
            product_id: productId,
            attributes: { note: 'second' },
            stock_quantity: 2,
          },
        ],
      })
    );
    expect(ambiguous).toEqual({ ok: false, code: 'product_unavailable' });
  });
});

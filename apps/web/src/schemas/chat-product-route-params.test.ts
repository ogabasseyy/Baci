import { describe, expect, it } from 'vitest';
import { chatProductRouteParamsSchema } from './chat-product-route-params';

describe('chatProductRouteParamsSchema', () => {
  it('accepts bounded merchant and generated product slugs', () => {
    expect(
      chatProductRouteParamsSchema.safeParse({
        slug: 'store-name',
        productSlug: 'iphone_13-pro',
      }).success
    ).toBe(true);
    expect(
      chatProductRouteParamsSchema.safeParse({
        slug: 's'.repeat(160),
        productSlug: 'p'.repeat(200),
      }).success
    ).toBe(true);
  });

  it('accepts bounded custom slugs supported by storefront PDP routing', () => {
    for (const productSlug of ['phone--case', '-phone..case-', 'café-店']) {
      expect(
        chatProductRouteParamsSchema.safeParse({
          slug: 'store-name',
          productSlug,
        }).success
      ).toBe(true);
    }
  });

  it('rejects empty, oversized, or malformed route slugs', () => {
    let overEncodedProductSlug = 'phone case';
    for (let index = 0; index < 12; index += 1) {
      overEncodedProductSlug = encodeURIComponent(overEncodedProductSlug);
    }

    for (const value of [
      { slug: '', productSlug: 'phone' },
      { slug: 'store', productSlug: '' },
      { slug: 's'.repeat(161), productSlug: 'phone' },
      { slug: 'store', productSlug: 'p'.repeat(201) },
      { slug: 'store_name', productSlug: 'phone' },
      { slug: 'store', productSlug: overEncodedProductSlug },
    ]) {
      expect(chatProductRouteParamsSchema.safeParse(value).success).toBe(false);
    }
  });
});

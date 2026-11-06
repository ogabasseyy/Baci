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
    for (const productSlug of [
      'phone--case',
      '-phone..case-',
      'café-店',
      'discount-100%-case',
      'battery-90%90-day',
    ]) {
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
      { slug: 'store', productSlug: '../escape' },
      { slug: 'store', productSlug: 'phone\\case' },
      { slug: 'store', productSlug: 'phone\u0000case' },
      { slug: 'store', productSlug: 'phone\u0085case' },
      { slug: 'store', productSlug: 'phone%C2%85%ZZ' },
      { slug: 'store', productSlug: '%2Fescape' },
      { slug: 'store', productSlug: '%252Fescape' },
      { slug: 'store', productSlug: 'phone%2F%ZZ' },
      { slug: 'store', productSlug: 'phone%252f%ZZ' },
      { slug: 'store', productSlug: 'phone%25252f%ZZ' },
      { slug: 'store', productSlug: 'phone%5Ccase' },
      { slug: 'store', productSlug: 'phone%255Ccase' },
      { slug: 'store', productSlug: '%00escape' },
      { slug: 'store', productSlug: '%2500escape' },
      { slug: 'store', productSlug: '%2E' },
      { slug: 'store', productSlug: '%2E%2E' },
      { slug: 'store', productSlug: '%252E%252E' },
      { slug: 'store', productSlug: '.' },
      { slug: 'store', productSlug: '..' },
    ]) {
      expect(chatProductRouteParamsSchema.safeParse(value).success).toBe(false);
    }
  });
});

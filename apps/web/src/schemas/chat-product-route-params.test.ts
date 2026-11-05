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
        productSlug: 'p'.repeat(160),
      }).success
    ).toBe(true);
  });

  it('rejects empty, oversized, or malformed route slugs', () => {
    for (const value of [
      { slug: '', productSlug: 'phone' },
      { slug: 'store', productSlug: '' },
      { slug: 's'.repeat(161), productSlug: 'phone' },
      { slug: 'store', productSlug: 'p'.repeat(161) },
      { slug: 'store_name', productSlug: 'phone' },
      { slug: 'store', productSlug: 'phone/../escape' },
      { slug: 'store', productSlug: 'phone--case' },
    ]) {
      expect(chatProductRouteParamsSchema.safeParse(value).success).toBe(false);
    }
  });
});

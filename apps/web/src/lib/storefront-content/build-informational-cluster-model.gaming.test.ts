import { describe, expect, it } from 'vitest';
import { buildInformationalClusterModel } from './build-informational-cluster-model';

describe('buildInformationalClusterModel gaming featured products', () => {
  it('features Sony-branded consoles for a PlayStation guide', async () => {
    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: {
        slug: 'playstation-5-buying-guide-nigeria',
        title: 'PlayStation 5 Buying Guide for Nigeria',
        excerpt: 'Our PS5 verdict for buyers in Nigeria.',
        category: 'Gaming',
        tags: ['playstation', 'ps5'],
        keywords: ['playstation 5'],
        featured_image_url: null,
        published_at: '2026-04-10T09:00:00.000Z',
        reading_time_minutes: 5,
      },
      categoryDataOverride: {
        category: { slug: 'gaming', name: 'Gaming' },
        products: [
          {
            slug: 'sony-ps5-console',
            name: 'Sony PS5 Console',
            brand: 'Sony',
            price: 850_000,
            category_slug: 'gaming',
            stock: 3,
          },
          {
            slug: 'xbox-controller',
            name: 'Xbox Controller',
            brand: 'Microsoft',
            price: 120_000,
            category_slug: 'gaming',
            stock: 3,
          },
        ],
        isCollection: false,
        destinationVerified: true,
      },
    });
    expect(model?.featuredProducts.map((product) => product.href)).toEqual([
      'https://ogabassey.com/gaming/sony-ps5-console',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { buildInformationalClusterModel } from './build-informational-cluster-model';

describe('buildInformationalClusterModel laptop hub links', () => {
  it('links a MacBook Air article to the laptops Apple and MacBook Air hubs', async () => {
    const post = {
      slug: 'macbook-air-m4-review-nigeria',
      title: 'MacBook Air M4 Review: Best Laptop for Nigeria',
      excerpt: 'Our MacBook Air verdict for buyers in Nigeria.',
      category: 'Laptops',
      tags: ['apple', 'macbook'],
      keywords: ['macbook air'],
      featured_image_url: null,
      published_at: '2026-04-10T09:00:00.000Z',
      reading_time_minutes: 5,
    };
    const names = [
      'MacBook Air M4',
      'MacBook Air M3',
      '13-inch MacBook Air M2',
      'MacBook Pro M4',
      'MacBook Pro M3',
    ];
    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post,
      categoryDataOverride: {
        category: { slug: 'laptops', name: 'Laptops' },
        products: names.map((name, index) => ({
          slug: name.toLowerCase().replaceAll(' ', '-'),
          name,
          brand: 'Apple',
          price: 1_500_000 - index * 50_000,
          category_slug: 'laptops',
          stock: 3,
        })),
        isCollection: false,
      },
    });
    const links = model?.commerceLinks.map((link) => link.href) ?? [];
    expect(links).toContain('https://ogabassey.com/laptops/brands/apple');
    expect(links).toContain(
      'https://ogabassey.com/laptops/brands/apple/families/macbook-air'
    );
  });
});

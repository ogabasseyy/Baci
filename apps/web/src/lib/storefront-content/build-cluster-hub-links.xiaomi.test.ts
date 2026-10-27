import { describe, expect, it } from 'vitest';
import { buildClusterHubLinks } from './build-cluster-hub-links';

const products = ['14T', '13T', '12T', '11T', '10T'].map((model) => ({
  name: `Xiaomi ${model}`,
  brand: 'Xiaomi',
  price: 100000,
  stock: 5,
  category_slug: 'smartphones',
}));

async function familyLinks(title: string, tags: string[]) {
  const result = await buildClusterHubLinks({
    post: {
      title,
      tags,
      slug: 'phone-comparison',
      excerpt: '',
      category: 'Smartphones',
      keywords: [],
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: null,
    },
    inferredBrands: ['Xiaomi'],
    categorySlug: 'smartphones',
    categoryName: 'Smartphones',
    storeUrl: 'https://store.test',
    merchantId: 'merchant-1',
    products,
    skipDestinationVerification: true,
  });
  return result.familyHubLinks.map((link) => link.href);
}

const destination =
  'https://store.test/smartphones/brands/xiaomi/families/xiaomi-t';

describe('Xiaomi T article model attribution', () => {
  it('does not attribute a rival bare token to a later Xiaomi mention', async () => {
    expect(await familyLinks('5T vs Xiaomi 13', ['OnePlus'])).not.toContain(
      destination
    );
  });

  it('keeps explicitly attributed Xiaomi models in multi-brand comparisons', async () => {
    expect(
      await familyLinks('Xiaomi 14T vs OnePlus 5T', ['OnePlus'])
    ).toContain(destination);
  });

  it('keeps bare title models attributed by Xiaomi tags', async () => {
    expect(await familyLinks('14T review', ['Xiaomi'])).toContain(destination);
  });
});

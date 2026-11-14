import { describe, expect, it } from 'vitest';
import { CATEGORY_HUB_DEFAULTS } from '@/config/category-hub-defaults';
import { resolveCategoryHubContent } from '@/lib/storefront-category/category-hub-content';

describe('resolveCategoryHubContent', () => {
  const expansionCategories = [
    { slug: 'gaming-laptops', name: 'Gaming Laptops' },
    { slug: 'tablets', name: 'Tablets' },
    { slug: 'audio', name: 'Audio & Speakers' },
    { slug: 'smartwatches', name: 'Smartwatches' },
    { slug: 'playstation-5', name: 'PlayStation 5' },
  ] as const;

  for (const { slug, name } of expansionCategories) {
    it(`resolves curated content for ${slug}`, () => {
      const expectedDefaults = CATEGORY_HUB_DEFAULTS[slug];
      const result = resolveCategoryHubContent({
        categorySlug: slug,
        categoryName: name,
        merchantBusinessName: 'Bassey Electronics',
        products: [],
      });

      expect(result.intro).toEqual({
        heading: expectedDefaults.intro.heading,
        description: expectedDefaults.intro.description,
        source: 'curated',
      });
      expect(result.trustFeatures).toEqual(expectedDefaults.trustFeatures);
      expect(result.faqItems).toEqual(expectedDefaults.faqItems);
    });
  }

  it('preserves merchant SEO overrides over curated defaults', () => {
    const result = resolveCategoryHubContent({
      categorySlug: 'gaming-laptops',
      categoryName: 'Gaming Laptops',
      merchantBusinessName: 'Bassey Electronics',
      categorySeo: {
        heading: 'Custom Merchant Gaming Laptops',
        description: 'Custom description for gaming laptops',
        features: ['Custom Feature 1'],
        faqs: [{ question: 'Custom Q?', answer: 'Custom A.' }],
      },
      products: [],
    });

    expect(result.intro).toEqual({
      heading: 'Custom Merchant Gaming Laptops',
      description: 'Custom description for gaming laptops',
      source: 'merchant',
    });
    expect(result.trustFeatures).toEqual(['Custom Feature 1']);
    expect(result.faqItems).toEqual([
      { question: 'Custom Q?', answer: 'Custom A.' },
    ]);
  });

  it('falls back to generic content for non-priority categories', () => {
    const result = resolveCategoryHubContent({
      categorySlug: 'refrigerators',
      categoryName: 'Refrigerators',
      merchantBusinessName: 'Bassey Electronics',
      products: [
        {
          name: 'LG Double Door Fridge',
          slug: 'lg-fridge',
          price: 450_000,
          brand: 'LG',
        },
      ],
    });

    expect(result.intro.source).toBe('fallback');
    expect(result.intro.heading).toBe('Refrigerators');
    expect(result.intro.description).toContain(
      'Bassey Electronics keeps 1 active products'
    );
  });
});

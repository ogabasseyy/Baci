import { describe, expect, it } from 'vitest';
import { buildProductSemanticModel } from './build-product-semantic-model';
import {
  makeCandidate,
  makeInput,
  publishedGuidePosts,
} from './build-product-semantic-model.test-helpers';

describe('buildProductSemanticModel', () => {
  it('keeps PDP support links when category inventory rows omit category_slug', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-17-pro-max',
      name: 'iPhone 17 Pro Max',
      brand: 'Apple',
      category_slug: undefined,
      price: 495_000,
      product_key_specs: {
        chipset: 'A19 Pro',
        ram_gb: 8,
        storage_gb: 256,
      },
    });
    const model = buildProductSemanticModel(
      makeInput({
        currentProduct,
        inventory: [
          currentProduct,
          makeCandidate({
            slug: 'samsung-galaxy-z-trifold',
            name: 'Samsung Galaxy Z TriFold',
            brand: 'Samsung',
            category_slug: undefined,
            price: 480_000,
            product_key_specs: {
              chipset: 'Snapdragon 8 Elite',
              ram_gb: 16,
              storage_gb: 512,
            },
          }),
        ],
      })
    );

    expect(model.supportLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      ])
    );
  });

  it('formats semantic card prices with the storefront country currency', () => {
    const currentProduct = makeCandidate({
      slug: 'kurta-set',
      name: 'Kurta Set',
      brand: 'Yodha',
      price: 2500,
    });
    const model = buildProductSemanticModel(
      makeInput({
        currentProduct,
        countryCode: 'IN',
        inventory: [
          currentProduct,
          makeCandidate({
            slug: 'lehenga-set',
            name: 'Lehenga Set',
            brand: 'Yodha',
            price: 5000,
          }),
        ],
      })
    );

    expect(model.sameBrand?.cards[0]?.description).toMatch(/₹|INR/);
    expect(model.sameBrand?.cards[0]?.description).not.toContain('₦');
    expect(model.trustBullets.join(' ')).toMatch(/₹|INR/);
    expect(model.trustBullets.join(' ')).not.toContain('₦');
  });

  it('keeps explicitly product-linked guides ahead of broader cluster guides', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-17-pro-max',
      name: 'iPhone 17 Pro Max',
      brand: 'Apple',
      price: 495_000,
    });
    const model = buildProductSemanticModel(
      makeInput({
        currentProduct,
        inventory: [currentProduct],
        guidePosts: [
          ...publishedGuidePosts,
          {
            slug: 'iphone-17-pro-max-buying-guide',
            title: 'iPhone 17 Pro Max Buying Guide',
            excerpt: 'Exact buying context for iPhone 17 Pro Max.',
            category: 'Smartphones',
            tags: ['smartphones', 'apple'],
            keywords: ['iphone 17 pro max'],
            featured_image_url: null,
            published_at: '2026-04-01T09:00:00.000Z',
            reading_time_minutes: 4,
          },
        ],
        priorityGuidePostSlugs: ['iphone-17-pro-max-buying-guide'],
      })
    );

    expect(model.guideLinks[0]).toMatchObject({
      href: 'https://ogabassey.com/blog/iphone-17-pro-max-buying-guide',
      title: 'iPhone 17 Pro Max Buying Guide',
    });
  });

  it('renders explicitly product-linked guides even without cluster metadata', () => {
    const currentProduct = makeCandidate({
      slug: 'lenovo-legion',
      name: 'Lenovo Legion',
      brand: 'Lenovo',
      price: 3_500_000,
      category_slug: 'laptops',
    });
    const model = buildProductSemanticModel(
      makeInput({
        categorySlug: 'laptops',
        categoryName: 'Laptops',
        currentProduct,
        inventory: [currentProduct],
        guidePosts: [
          {
            slug: 'lenovo-legion-warranty-support',
            title: 'Warranty Support Checklist',
            excerpt: null,
            category: 'Support',
            tags: null,
            keywords: null,
            featured_image_url: null,
            published_at: '2026-04-01T09:00:00.000Z',
            reading_time_minutes: 3,
          },
          ...publishedGuidePosts,
        ],
        priorityGuidePostSlugs: ['lenovo-legion-warranty-support'],
      })
    );

    expect(model.guideLinks[0]).toEqual({
      href: 'https://ogabassey.com/blog/lenovo-legion-warranty-support',
      title: 'Warranty Support Checklist',
      description: '3 minute guide',
      kind: 'buyer-guide',
    });
  });

  it('falls back to Nigerian currency for semantic trust bullets', () => {
    const currentProduct = makeCandidate({
      slug: 'galaxy-a56',
      name: 'Galaxy A56',
      brand: 'Samsung',
      price: 410_000,
    });
    const model = buildProductSemanticModel(
      makeInput({
        currentProduct,
        inventory: [
          currentProduct,
          makeCandidate({
            slug: 'galaxy-a36',
            name: 'Galaxy A36',
            brand: 'Samsung',
            price: 360_000,
          }),
        ],
      })
    );

    expect(model.trustBullets.join(' ')).toContain('₦');
    expect(model.trustBullets.join(' ')).not.toMatch(/₹|INR/);
  });
});

import { describe, expect, it } from 'vitest';
import { buildProductGuideLinks } from './build-product-guide-links';
import type { BuildProductSemanticModelInput } from './product-semantic-types';

function makeInput(
  overrides: Partial<BuildProductSemanticModelInput> = {}
): BuildProductSemanticModelInput {
  return {
    storeUrl: 'https://ogabassey.com',
    merchantBusinessName: 'Ogabassey',
    categorySlug: 'smartphones',
    categoryName: 'Smartphones',
    currentProduct: {
      slug: 'iphone-16e',
      name: 'iPhone 16e',
      price: 450_000,
      brand: 'Apple',
      condition: 'new',
      stock: 4,
      category_slug: 'smartphones',
      product_key_specs: {},
    },
    inventory: [],
    ...overrides,
  };
}

describe('buildProductGuideLinks - priority validation and ranking', () => {
  it('ranks legitimate priority guide ahead of fallback guides', () => {
    const priorityPost = {
      slug: 'iphone-buying-guide',
      title: 'iPhone Buying Guide',
      excerpt: null,
      category: 'Smartphones',
      tags: ['smartphones', 'apple'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: '2026-04-01T00:00:00.000Z',
      reading_time_minutes: 4,
    };
    const fallbackPost = {
      slug: 'best-phones-in-nigeria',
      title: 'Best Phones in Nigeria for 2026',
      excerpt: null,
      category: 'Smartphones',
      tags: ['smartphones'],
      keywords: ['best'],
      featured_image_url: null,
      published_at: '2026-04-10T00:00:00.000Z',
      reading_time_minutes: 6,
    };

    const links = buildProductGuideLinks(
      makeInput({
        priorityGuidePostSlugs: [priorityPost.slug],
        guidePosts: [fallbackPost, priorityPost],
      })
    );

    expect(links.length).toBeGreaterThan(0);
    expect(links[0].href).toBe(
      'https://ogabassey.com/blog/iphone-buying-guide'
    );
  });

  it('rejects same-category mismatched-brand priority guide and yields to matching fallback guide', () => {
    const mismatchedPriorityPost = {
      slug: 'samsung-galaxy-s24-ultra-buyer-guide',
      title: 'Samsung Galaxy S24 Ultra Buyer Guide',
      excerpt: 'Complete buying guide for Samsung Galaxy S24 Ultra.',
      category: 'Smartphones',
      tags: ['smartphones', 'samsung'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: '2026-04-01T00:00:00.000Z',
      reading_time_minutes: 5,
    };
    const matchingFallbackPost = {
      slug: 'iphone-buying-guide',
      title: 'iPhone Buying Guide',
      excerpt: 'How to choose your Apple iPhone in Nigeria.',
      category: 'Smartphones',
      tags: ['smartphones', 'apple'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: '2026-04-10T00:00:00.000Z',
      reading_time_minutes: 4,
    };

    const links = buildProductGuideLinks(
      makeInput({
        priorityGuidePostSlugs: [mismatchedPriorityPost.slug],
        guidePosts: [mismatchedPriorityPost, matchingFallbackPost],
      })
    );

    expect(links).toHaveLength(1);
    expect(links[0].href).toBe(
      'https://ogabassey.com/blog/iphone-buying-guide'
    );

    const isolatedLinks = buildProductGuideLinks(
      makeInput({
        priorityGuidePostSlugs: [mismatchedPriorityPost.slug],
        guidePosts: [mismatchedPriorityPost],
      })
    );
    expect(isolatedLinks).toEqual([]);
  });

  it('rejects Acer Predator gaming laptop guide on Dell Alienware PDP and rejects HP Omen guide on Acer Predator PDP', () => {
    const acerPredatorGuide = {
      slug: 'acer-predator-helios-gaming-laptop-buyer-guide',
      title: 'Acer Predator Helios Gaming Laptop Buyer Guide',
      excerpt: 'Comprehensive buyer guide for Acer Predator gaming laptops.',
      category: 'Gaming',
      tags: ['gaming', 'acer', 'predator', 'gaming laptop'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: '2026-04-01T00:00:00.000Z',
      reading_time_minutes: 6,
    };
    const alienwareGuide = {
      slug: 'alienware-m16-gaming-laptop-review-and-guide',
      title: 'Alienware m16 Gaming Laptop Review & Buyer Guide',
      excerpt: 'High-performance mobile gaming from Dell Alienware.',
      category: 'Gaming',
      tags: ['gaming', 'dell', 'alienware', 'gaming laptop'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: '2026-04-05T00:00:00.000Z',
      reading_time_minutes: 5,
    };
    const hpOmenGuide = {
      slug: 'hp-omen-16-gaming-laptop-guide',
      title: 'HP Omen 16 Gaming Laptop Buying Guide',
      excerpt: 'Reviewing HP Omen gaming laptops in Nigeria.',
      category: 'Gaming',
      tags: ['gaming', 'hp', 'omen', 'gaming laptop'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: '2026-04-06T00:00:00.000Z',
      reading_time_minutes: 5,
    };

    // On Dell Alienware PDP: Acer Predator guide is rejected, Alienware guide is returned
    const alienwarePdpLinks = buildProductGuideLinks(
      makeInput({
        categorySlug: 'gaming-laptops',
        categoryName: 'Gaming Laptops',
        currentProduct: {
          slug: 'dell-alienware-m16',
          name: 'Dell Alienware m16 R2 Gaming Laptop',
          price: 1_850_000,
          brand: 'Dell',
          condition: 'new',
          stock: 3,
          category_slug: 'gaming-laptops',
          product_key_specs: {},
        },
        priorityGuidePostSlugs: [acerPredatorGuide.slug],
        guidePosts: [acerPredatorGuide, alienwareGuide],
      })
    );
    expect(alienwarePdpLinks).toHaveLength(1);
    expect(alienwarePdpLinks[0].href).toBe(
      'https://ogabassey.com/blog/alienware-m16-gaming-laptop-review-and-guide'
    );

    // On Acer Predator PDP: HP Omen priority guide is rejected, Acer Predator guide is returned
    const acerPdpLinks = buildProductGuideLinks(
      makeInput({
        categorySlug: 'gaming-laptops',
        categoryName: 'Gaming Laptops',
        currentProduct: {
          slug: 'acer-predator-helios-16',
          name: 'Acer Predator Helios 16 Gaming Laptop',
          price: 1_650_000,
          brand: 'Acer',
          condition: 'new',
          stock: 4,
          category_slug: 'gaming-laptops',
          product_key_specs: {},
        },
        priorityGuidePostSlugs: [hpOmenGuide.slug],
        guidePosts: [hpOmenGuide, acerPredatorGuide],
      })
    );
    expect(acerPdpLinks).toHaveLength(1);
    expect(acerPdpLinks[0].href).toBe(
      'https://ogabassey.com/blog/acer-predator-helios-gaming-laptop-buyer-guide'
    );
  });

  it('preserves same-category platform guide for PDP with unmapped publisher brand (EA Sports on PS5)', () => {
    const ps5BuyerGuide = {
      slug: 'best-ps5-games-buyer-guide',
      title: 'Best PS5 Games Buyer Guide in Nigeria (2026)',
      excerpt: 'Complete buying guide for PlayStation 5 games.',
      category: 'PlayStation 5',
      tags: ['playstation-5', 'ps5', 'gaming'],
      keywords: ['buyer guide', 'ps5', 'games'],
      featured_image_url: null,
      published_at: '2026-04-01T00:00:00.000Z',
      reading_time_minutes: 6,
    };

    const priorityLinks = buildProductGuideLinks(
      makeInput({
        categorySlug: 'playstation-5',
        categoryName: 'PlayStation 5',
        currentProduct: {
          slug: 'ea-sports-fc-27',
          name: 'EA Sports FC 27',
          price: 90_000,
          brand: 'EA Sports',
          condition: 'new',
          stock: 5,
          category_slug: 'playstation-5',
          product_key_specs: {},
        },
        priorityGuidePostSlugs: [ps5BuyerGuide.slug],
        guidePosts: [ps5BuyerGuide],
      })
    );
    expect(priorityLinks).toHaveLength(1);
    expect(priorityLinks[0].href).toBe(
      'https://ogabassey.com/blog/best-ps5-games-buyer-guide'
    );

    const fallbackLinks = buildProductGuideLinks(
      makeInput({
        categorySlug: 'playstation-5',
        categoryName: 'PlayStation 5',
        currentProduct: {
          slug: 'ea-sports-fc-27',
          name: 'EA Sports FC 27',
          price: 90_000,
          brand: 'EA Sports',
          condition: 'new',
          stock: 5,
          category_slug: 'playstation-5',
          product_key_specs: {},
        },
        priorityGuidePostSlugs: [],
        guidePosts: [ps5BuyerGuide],
      })
    );
    expect(fallbackLinks).toHaveLength(1);
    expect(fallbackLinks[0].href).toBe(
      'https://ogabassey.com/blog/best-ps5-games-buyer-guide'
    );
  });

  it('permits same-category guide with different brand as fallback when not flagged as priority', () => {
    const samsungGuide = {
      slug: 'samsung-galaxy-s26-ultra-buyer-guide',
      title: 'Samsung Galaxy S26 Ultra Buyer Guide',
      excerpt: 'Detailed review of Samsung Galaxy S26 Ultra.',
      category: 'Smartphones',
      tags: ['smartphones', 'samsung'],
      keywords: ['buyer guide', 'samsung'],
      featured_image_url: null,
      published_at: '2026-04-01T00:00:00.000Z',
      reading_time_minutes: 5,
    };

    // When flagged as priority on an Apple iPhone PDP, brand mismatch drops it from priority
    const priorityLinks = buildProductGuideLinks(
      makeInput({
        priorityGuidePostSlugs: [samsungGuide.slug],
        guidePosts: [samsungGuide],
      })
    );
    expect(priorityLinks).toHaveLength(0);

    // When provided solely as fallback, same-category guide is retained via category scoring
    const fallbackLinks = buildProductGuideLinks(
      makeInput({
        priorityGuidePostSlugs: [],
        guidePosts: [samsungGuide],
      })
    );
    expect(fallbackLinks).toHaveLength(1);
    expect(fallbackLinks[0].href).toBe(
      'https://ogabassey.com/blog/samsung-galaxy-s26-ultra-buyer-guide'
    );
  });
});

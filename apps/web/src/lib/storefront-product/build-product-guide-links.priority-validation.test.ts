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

function makePost(
  slug: string,
  title: string,
  category: string,
  tags: string[]
) {
  return {
    slug,
    title,
    excerpt: null,
    category,
    tags,
    keywords: ['buyer guide'],
    featured_image_url: null,
    published_at: '2026-04-01T00:00:00.000Z',
    reading_time_minutes: 5,
  };
}

describe('buildProductGuideLinks - priority validation and ranking', () => {
  it('ranks legitimate priority guide ahead of fallback guides', () => {
    const priorityPost = makePost(
      'iphone-buying-guide',
      'iPhone Buying Guide',
      'Smartphones',
      ['smartphones', 'apple']
    );
    const fallbackPost = makePost(
      'best-phones-in-nigeria',
      'Best Phones in Nigeria for 2026',
      'Smartphones',
      ['smartphones']
    );

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
    const mismatchedPriorityPost = makePost(
      'samsung-galaxy-s24-ultra-buyer-guide',
      'Samsung Galaxy S24 Ultra Buyer Guide',
      'Smartphones',
      ['smartphones', 'samsung']
    );
    const matchingFallbackPost = makePost(
      'iphone-buying-guide',
      'iPhone Buying Guide',
      'Smartphones',
      ['smartphones', 'apple']
    );

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
    const acerPredatorGuide = makePost(
      'acer-predator-helios-gaming-laptop-buyer-guide',
      'Acer Predator Helios Gaming Laptop Buyer Guide',
      'Gaming',
      ['gaming', 'acer', 'predator', 'gaming laptop']
    );
    const alienwareGuide = makePost(
      'alienware-m16-gaming-laptop-review-and-guide',
      'Alienware m16 Gaming Laptop Review & Buyer Guide',
      'Gaming',
      ['gaming', 'dell', 'alienware', 'gaming laptop']
    );
    const hpOmenGuide = makePost(
      'hp-omen-16-gaming-laptop-guide',
      'HP Omen 16 Gaming Laptop Buying Guide',
      'Gaming',
      ['gaming', 'hp', 'omen', 'gaming laptop']
    );

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
    const ps5BuyerGuide = makePost(
      'best-ps5-games-buyer-guide',
      'Best PS5 Games Buyer Guide in Nigeria (2026)',
      'PlayStation 5',
      ['playstation-5', 'ps5', 'gaming']
    );

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

  it('rejects different-platform priority guide on generic gaming PDP with configured brand', () => {
    const xboxGuide = makePost(
      'xbox-series-x-buyer-guide',
      'Xbox Series X Buyer Guide',
      'Gaming',
      ['gaming', 'xbox']
    );

    const ps5Links = buildProductGuideLinks(
      makeInput({
        categorySlug: 'gaming',
        categoryName: 'Gaming',
        currentProduct: {
          slug: 'sony-playstation-5',
          name: 'Sony PlayStation 5 Console',
          price: 650_000,
          brand: 'Sony',
          condition: 'new',
          stock: 4,
          category_slug: 'gaming',
          product_key_specs: {},
        },
        priorityGuidePostSlugs: [xboxGuide.slug],
        guidePosts: [xboxGuide],
      })
    );
    expect(ps5Links).toHaveLength(0);
  });

  it('permits same-category guide with different brand as fallback when not flagged as priority', () => {
    const samsungGuide = makePost(
      'samsung-galaxy-s26-ultra-buyer-guide',
      'Samsung Galaxy S26 Ultra Buyer Guide',
      'Smartphones',
      ['smartphones', 'samsung']
    );

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

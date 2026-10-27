import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildInformationalClusterModel } from './build-informational-cluster-model';

vi.mock(
  '@/lib/storefront-product/load-category-scoped-semantic-inventory-safely',
  () => ({ loadCategoryScopedSemanticInventorySafely: vi.fn() })
);

const product = (
  slug: string,
  name: string,
  brand: string,
  price: number,
  specs: Record<string, unknown>
) => ({
  slug,
  name,
  brand,
  price,
  category_slug: 'smartphones',
  stock: 3,
  product_key_specs: specs,
});

describe('buildInformationalClusterModel commerce link cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reserves a slot for verified commerce links when brand and family hubs fill the cap', async () => {
    const appleSpecs = { chipset: 'A17 Pro', ram_gb: 8, camera_mp: 48 };
    const samsungSpecs = {
      chipset: 'Snapdragon 8 Gen 3',
      ram_gb: 12,
      camera_mp: 200,
    };
    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: {
        slug: 'iphone-vs-galaxy-buying-guide',
        title: 'iPhone 15 vs iPhone 14 vs Galaxy S24: Which Should You Buy?',
        excerpt:
          'We compare the iPhone 15, iPhone 14, Galaxy S24 and Galaxy A55 lineups for Nigerian buyers.',
        category: 'Smartphones',
        tags: ['apple', 'samsung', 'iphone', 'galaxy'],
        keywords: ['iphone 15', 'iphone 14', 'galaxy s24'],
        featured_image_url: null,
        published_at: '2026-04-10T09:00:00.000Z',
        reading_time_minutes: 5,
      },
      categoryDataOverride: {
        category: { slug: 'smartphones', name: 'Smartphones' },
        products: [
          product(
            'iphone-15-pro-max',
            'iPhone 15 Pro Max',
            'Apple',
            900_000,
            appleSpecs
          ),
          product(
            'iphone-15-pro',
            'iPhone 15 Pro',
            'Apple',
            800_000,
            appleSpecs
          ),
          product('iphone-15', 'iPhone 15', 'Apple', 650_000, appleSpecs),
          product(
            'iphone-14-pro',
            'iPhone 14 Pro',
            'Apple',
            600_000,
            appleSpecs
          ),
          product(
            'iphone-14-plus',
            'iPhone 14 Plus',
            'Apple',
            550_000,
            appleSpecs
          ),
          product('iphone-14', 'iPhone 14', 'Apple', 500_000, appleSpecs),
          product(
            'galaxy-s24-ultra',
            'Galaxy S24 Ultra',
            'Samsung',
            850_000,
            samsungSpecs
          ),
          product(
            'galaxy-s24-plus',
            'Galaxy S24 Plus',
            'Samsung',
            750_000,
            samsungSpecs
          ),
          product('galaxy-s24', 'Galaxy S24', 'Samsung', 700_000, samsungSpecs),
          product('galaxy-a55', 'Galaxy A55', 'Samsung', 400_000, samsungSpecs),
          product('galaxy-a35', 'Galaxy A35', 'Samsung', 350_000, samsungSpecs),
        ],
        isCollection: false,
        destinationVerified: true,
      },
    });

    const links = model?.commerceLinks.map((link) => link.href) ?? [];
    expect(links).toHaveLength(5);
    expect(links).toContain('https://ogabassey.com/smartphones/brands/apple');
    expect(links).toContain('https://ogabassey.com/smartphones/brands/samsung');
    // The verified brand comparison must survive the five-link cap even
    // though two brand hubs and three family hubs precede it.
    expect(links).toContain(
      'https://ogabassey.com/smartphones/compare/apple-vs-samsung'
    );
    const familyLinks = links.filter((href) => href.includes('/families/'));
    expect(familyLinks.length).toBeGreaterThanOrEqual(1);
    expect(familyLinks.length).toBeLessThanOrEqual(2);
  });

  it('reserves a slot for verified commerce links when five brand hubs compete', async () => {
    const brands = ['Apple', 'Samsung', 'Google', 'Infinix', 'Tecno'];
    const products = brands.flatMap((brand, brandIndex) =>
      [1, 2, 3, 4, 5].map((index) =>
        product(
          `${brand.toLowerCase()}-phone-${index}`,
          `${brand} Smartphone ${index}`,
          brand,
          300_000 + brandIndex * 50_000 + index * 10_000,
          {
            chipset: `${brand} Chip`,
            ram_gb: 6 + brandIndex,
            camera_mp: 48 + brandIndex * 10,
          }
        )
      )
    );
    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: {
        slug: 'best-smartphones-nigeria-compared',
        title:
          'Best Smartphones in Nigeria: Apple, Samsung, Google, Infinix and Tecno Compared',
        excerpt:
          'We compare Apple, Samsung, Google Pixel, Infinix and Tecno smartphones for Nigerian buyers.',
        category: 'Smartphones',
        tags: ['apple', 'samsung', 'google', 'infinix', 'tecno'],
        keywords: ['best smartphones', 'apple samsung google infinix tecno'],
        featured_image_url: null,
        published_at: '2026-04-10T09:00:00.000Z',
        reading_time_minutes: 5,
      },
      categoryDataOverride: {
        category: { slug: 'smartphones', name: 'Smartphones' },
        products,
        isCollection: false,
        destinationVerified: true,
      },
    });

    const links = model?.commerceLinks.map((link) => link.href) ?? [];
    expect(links).toHaveLength(5);
    expect(links.some((href) => href.includes('/smartphones/brands/'))).toBe(
      true
    );
    // Five eligible brand hubs must not crowd out the verified comparison.
    expect(links).toContain(
      'https://ogabassey.com/smartphones/compare/apple-vs-google'
    );
  });
});

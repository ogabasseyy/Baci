import { describe, expect, it } from 'vitest';
import { brandAuthorityTaxonomy } from './brand-authority-taxonomy';
import { buildCategoryHubBrandCards } from './category-hub-brand-cards';

const product = (
  slug: string,
  name: string,
  brand = 'HP',
  price = 300_000
) => ({
  slug,
  name,
  brand,
  price,
  category_slug: 'laptops',
});

describe('category brand navigation truth', () => {
  it('names the actual laptop PDP and identifies the current page count', () => {
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'laptops',
      storeUrl: 'https://shop.test',
      products: [
        product('elitebook', 'HP EliteBook'),
        product('probook', 'HP ProBook', 'HP', 400_000),
      ],
    });
    expect(cards).toEqual([
      expect.objectContaining({
        title: 'HP EliteBook',
        href: 'https://shop.test/laptops/elitebook',
        eyebrow: 'HP product pick',
        description: '2 HP products on this page.',
      }),
    ]);
  });

  it('changes the PDP pick and page count honestly on later pages', () => {
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'laptops',
      storeUrl: 'https://shop.test',
      products: [product('elitebook-g2', 'HP EliteBook G2')],
    });
    expect(cards[0]).toMatchObject({
      title: 'HP EliteBook G2',
      description: '1 HP product on this page.',
    });
  });

  it('matches normalized brands when choosing a real product destination', () => {
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'laptops',
      storeUrl: 'https://shop.test',
      products: [product('elitebook', 'HP EliteBook', ' HP ')],
    });
    expect(cards[0]?.href).toBe('https://shop.test/laptops/elitebook');
  });
  it('keeps real smartphone authority links and their supplied category-wide totals', () => {
    const entry = brandAuthorityTaxonomy.getEntry('smartphones', 'apple');
    expect(entry).not.toBeNull();
    if (!entry) throw new Error('Apple authority entry required');
    const [card] = buildCategoryHubBrandCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://shop.test',
      products: [],
      brandAuthorityEntries: [
        { ...entry, productCount: 48, productCountIsLowerBound: true },
      ],
    });
    expect(card).toMatchObject({
      title: 'Apple iPhone',
      href: 'https://shop.test/smartphones/brands/apple',
      description: '48+ active products in this category.',
    });
  });
});

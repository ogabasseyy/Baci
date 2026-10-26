import { describe, expect, it } from 'vitest';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';

function makeProducts(brand: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    slug: `${brand.toLowerCase()}-${index}`,
    name: `${brand} ${index}`,
    brand,
    price: 100_000 + index,
  }));
}

describe('brand authority taxonomy', () => {
  it('resolves only curated category and brand pairs', () => {
    expect(
      brandAuthorityTaxonomy.getEntry('smartphones', 'Google')
    ).toMatchObject({
      brandKey: 'google',
      displayName: 'Google Pixel',
    });
    expect(brandAuthorityTaxonomy.getEntry('laptops', 'samsung')).toBeNull();
    expect(
      brandAuthorityTaxonomy.getEntry('smartphones', 'unknown')
    ).toBeNull();
  });

  it('keeps only brands with enough category inventory', () => {
    const eligible = brandAuthorityTaxonomy.getEligibleEntries('smartphones', [
      ...makeProducts('Samsung', 5),
      ...makeProducts('Tecno', 4),
      ...makeProducts('Google', 6),
    ]);

    expect(eligible).toEqual([
      expect.objectContaining({ brandKey: 'samsung', productCount: 5 }),
      expect.objectContaining({ brandKey: 'google', productCount: 6 }),
    ]);
  });

  it('exposes supported categories and their database query values', () => {
    expect(brandAuthorityTaxonomy.getSupportedCategories()).toEqual([
      'smartphones',
    ]);
    expect(brandAuthorityTaxonomy.getEntries('smartphones')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          brandKey: 'google',
          brandQueryValue: 'Google',
        }),
      ])
    );
    expect(brandAuthorityTaxonomy.getEntries('Smartphones')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          brandKey: 'google',
          brandQueryValue: 'Google',
        }),
      ])
    );
    expect(brandAuthorityTaxonomy.getEntries('unknown')).toEqual([]);
  });

  it('maps Redmi inventory into the Xiaomi authority hub', () => {
    // Arrange
    const redmiProducts = makeProducts('Redmi', 5);

    // Act
    const xiaomiEntry = brandAuthorityTaxonomy.getEntry(
      'smartphones',
      'xiaomi'
    );
    const eligibleEntries = brandAuthorityTaxonomy.getEligibleEntries(
      'smartphones',
      redmiProducts
    );
    const oppoEntry = brandAuthorityTaxonomy.getEntry('smartphones', 'oppo');
    const redmiEntry = brandAuthorityTaxonomy.getEntry('smartphones', 'redmi');

    // Assert
    expect(xiaomiEntry).toMatchObject({
      brandAliases: ['Redmi'],
      brandQueryValue: 'Xiaomi',
      displayName: 'Xiaomi and Redmi',
    });
    expect(eligibleEntries).toEqual([
      expect.objectContaining({ brandKey: 'xiaomi', productCount: 5 }),
    ]);
    expect(oppoEntry).toMatchObject({
      brandQueryValue: 'Oppo',
      displayName: 'Oppo',
    });
    expect(redmiEntry).toBeNull();
  });

  it('resolves Apple iPhone authority hub and matches Apple and iPhone products', () => {
    // Act
    const appleEntry = brandAuthorityTaxonomy.getEntry('smartphones', 'apple');
    const appleEntryByAlias = brandAuthorityTaxonomy.getEntry(
      'smartphones',
      'Apple'
    );

    // Assert
    expect(appleEntry).toMatchObject({
      brandAliases: ['iPhone'],
      brandKey: 'apple',
      brandQueryValue: 'Apple',
      brandSlug: 'apple',
      categorySlug: 'smartphones',
      displayName: 'Apple iPhone',
      minimumProducts: 5,
    });
    expect(appleEntryByAlias).toEqual(appleEntry);

    if (!appleEntry) {
      throw new Error('Expected Apple taxonomy entry');
    }

    expect(brandAuthorityTaxonomy.matchesBrand(appleEntry, 'Apple')).toBe(true);
    expect(brandAuthorityTaxonomy.matchesBrand(appleEntry, 'iPhone')).toBe(
      true
    );
    expect(brandAuthorityTaxonomy.matchesBrand(appleEntry, 'apple')).toBe(true);
    expect(brandAuthorityTaxonomy.matchesBrand(appleEntry, 'iphone')).toBe(
      true
    );
    expect(brandAuthorityTaxonomy.matchesBrand(appleEntry, 'Samsung')).toBe(
      false
    );
  });
});

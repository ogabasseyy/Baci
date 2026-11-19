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
      'laptops',
      'gaming-laptops',
      'tablets',
      'audio',
      'smartwatches',
      'playstation-5',
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

  it('resolves Honor smartphone authority hub', () => {
    const honorEntry = brandAuthorityTaxonomy.getEntry('smartphones', 'honor');
    expect(honorEntry).toMatchObject({
      brandKey: 'honor',
      brandQueryValue: 'Honor',
      categorySlug: 'smartphones',
      displayName: 'Honor',
      minimumProducts: 5,
    });
  });

  it('resolves Apple MacBook laptop authority hub and matches aliases', () => {
    const macbookEntry = brandAuthorityTaxonomy.getEntry('laptops', 'apple');
    expect(macbookEntry).toMatchObject({
      brandAliases: ['MacBook'],
      brandKey: 'apple',
      brandQueryValue: 'Apple',
      brandSlug: 'apple',
      categorySlug: 'laptops',
      displayName: 'Apple MacBook',
      intro:
        'Compare Apple MacBook Air and MacBook Pro laptops at {merchantName} across M-series and Intel configurations.',
      minimumProducts: 5,
    });

    if (!macbookEntry) {
      throw new Error('Expected Apple MacBook entry');
    }

    expect(brandAuthorityTaxonomy.matchesBrand(macbookEntry, 'Apple')).toBe(
      true
    );
    expect(brandAuthorityTaxonomy.matchesBrand(macbookEntry, 'MacBook')).toBe(
      true
    );
    expect(brandAuthorityTaxonomy.matchesBrand(macbookEntry, 'apple')).toBe(
      true
    );
    expect(brandAuthorityTaxonomy.matchesBrand(macbookEntry, 'Dell')).toBe(
      false
    );
  });

  it('resolves gaming-laptops brand authority entries and handles Dell Alienware alias', () => {
    const dellEntry = brandAuthorityTaxonomy.getEntry('gaming-laptops', 'dell');
    expect(dellEntry).toMatchObject({
      brandAliases: ['Alienware'],
      brandKey: 'dell',
      brandQueryValue: 'Dell',
      categorySlug: 'gaming-laptops',
      displayName: 'Dell',
      minimumProducts: 5,
    });
    if (!dellEntry) throw new Error('Expected Dell entry');
    expect(brandAuthorityTaxonomy.matchesBrand(dellEntry, 'Dell')).toBe(true);
    expect(brandAuthorityTaxonomy.matchesBrand(dellEntry, 'Alienware')).toBe(
      true
    );
    expect(brandAuthorityTaxonomy.matchesBrand(dellEntry, 'alienware')).toBe(
      true
    );

    const asusEntry = brandAuthorityTaxonomy.getEntry('gaming-laptops', 'asus');
    expect(asusEntry).toMatchObject({
      brandKey: 'asus',
      brandQueryValue: 'ASUS',
      displayName: 'ASUS',
    });
  });

  it('resolves tablets, audio, smartwatches, and playstation-5 authority hubs', () => {
    const psEntry = brandAuthorityTaxonomy.getEntry(
      'playstation-5',
      'playstation'
    );
    expect(psEntry).toMatchObject({
      brandAliases: ['PlayStation Studios'],
      brandKey: 'playstation',
      brandQueryValue: 'PlayStation',
      categorySlug: 'playstation-5',
      displayName: 'PlayStation',
    });
    if (!psEntry) throw new Error('Expected PS entry');
    expect(
      brandAuthorityTaxonomy.matchesBrand(psEntry, 'PlayStation Studios')
    ).toBe(true);

    const jblEntry = brandAuthorityTaxonomy.getEntry('audio', 'jbl');
    expect(jblEntry).toMatchObject({ brandKey: 'jbl', displayName: 'JBL' });

    const watchApple = brandAuthorityTaxonomy.getEntry('smartwatches', 'apple');
    expect(watchApple).toMatchObject({
      brandKey: 'apple',
      displayName: 'Apple',
    });

    const tabletXiaomi = brandAuthorityTaxonomy.getEntry('tablets', 'xiaomi');
    expect(tabletXiaomi).toMatchObject({
      brandAliases: ['Redmi'],
      brandKey: 'xiaomi',
      displayName: 'Xiaomi and Redmi',
    });
  });

  it('pins total brand-authority entries across all categories to 27', () => {
    const totalEntries = brandAuthorityTaxonomy
      .getSupportedCategories()
      .flatMap((category) => brandAuthorityTaxonomy.getEntries(category));
    expect(totalEntries).toHaveLength(27);
  });
});

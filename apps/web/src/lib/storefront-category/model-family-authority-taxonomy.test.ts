import { describe, expect, it } from 'vitest';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';

describe('model family authority taxonomy', () => {
  it('resolves curated family routes only', () => {
    // Arrange
    const supportedRoute = ['smartphones', 'samsung', 'galaxy-s'] as const;
    const unsupportedRoute = ['laptops', 'samsung', 'galaxy-s'] as const;

    // Act
    const supportedEntry = modelFamilyAuthorityTaxonomy.getEntry(
      ...supportedRoute
    );
    const unsupportedEntry = modelFamilyAuthorityTaxonomy.getEntry(
      ...unsupportedRoute
    );

    // Assert
    expect(supportedEntry).toMatchObject({
      displayName: 'Samsung Galaxy S',
      minimumProducts: 3,
    });
    expect(unsupportedEntry).toBeNull();
  });

  it('keeps the Infinix HOT family eligible with two distinct active models', () => {
    expect(
      modelFamilyAuthorityTaxonomy.getEntry('smartphones', 'infinix', 'hot')
    ).toMatchObject({ minimumProducts: 2 });
    expect(
      modelFamilyAuthorityTaxonomy.getEntry('smartphones', 'infinix', 'note')
    ).toMatchObject({ minimumProducts: 3 });
  });

  it('matches distinct Xiaomi and Redmi families without overlap', () => {
    // Arrange
    const entries = modelFamilyAuthorityTaxonomy.getEntries(
      'smartphones',
      'xiaomi'
    );
    const matchingKeys = (name: string) =>
      entries
        .filter((entry) =>
          modelFamilyAuthorityTaxonomy.matchesProduct(entry, name)
        )
        .map((entry) => entry.familyKey);

    // Act
    const matches = {
      redmiNote: matchingKeys('Redmi Note 15 Pro'),
      redmiA: matchingKeys('Redmi A7 Pro'),
      redmi15: matchingKeys('Redmi 15C 5G'),
      xiaomiRedmiNote: matchingKeys('Xiaomi Redmi Note 14'),
      xiaomiRedmiA: matchingKeys('Xiaomi Redmi A5'),
      xiaomiT: matchingKeys('Xiaomi 17T Pro'),
    };

    // Assert
    expect(matches.redmiNote).toEqual(['redmi-note']);
    expect(matches.redmiA).toEqual(['redmi-a']);
    expect(matches.redmi15).toEqual(['redmi-15']);
    expect(matches.xiaomiRedmiNote).toEqual(['redmi-note']);
    expect(matches.xiaomiRedmiA).toEqual(['redmi-a']);
    expect(matches.xiaomiT).toEqual(['xiaomi-t']);
  });

  it('matches case-insensitive family names', () => {
    // Arrange
    const entry = modelFamilyAuthorityTaxonomy.getEntry(
      'smartphones',
      'tecno',
      'pop'
    );
    if (!entry) throw new Error('Expected Tecno Pop family entry');

    // Act
    const matches = modelFamilyAuthorityTaxonomy.matchesProduct(
      entry,
      'Tecno POP 10 Pro'
    );

    // Assert
    expect(matches).toBe(true);
  });

  it('matches family names when the product name omits its separate brand', () => {
    // Arrange
    const entry = modelFamilyAuthorityTaxonomy.getEntry(
      'smartphones',
      'samsung',
      'galaxy-s'
    );
    if (!entry) throw new Error('Expected Samsung Galaxy S family entry');

    // Act
    const matches = modelFamilyAuthorityTaxonomy.matchesProduct(
      entry,
      'Galaxy S24 Ultra'
    );

    // Assert
    expect(matches).toBe(true);
  });

  it('does not classify Oppo Ace as A-series while preserving Oppo A5', () => {
    // Arrange
    const entry = modelFamilyAuthorityTaxonomy.getEntry(
      'smartphones',
      'oppo',
      'a-series'
    );
    if (!entry) throw new Error('Expected Oppo A-series family entry');

    // Act
    const matchesA5 = modelFamilyAuthorityTaxonomy.matchesProduct(
      entry,
      'Oppo A5'
    );
    const matchesA5WithExtraWhitespace =
      modelFamilyAuthorityTaxonomy.matchesProduct(entry, 'Oppo  A5');
    const matchesAce = modelFamilyAuthorityTaxonomy.matchesProduct(
      entry,
      'Oppo Ace 2'
    );

    // Assert
    expect(matchesA5).toBe(true);
    expect(matchesA5WithExtraWhitespace).toBe(true);
    expect(matchesAce).toBe(false);
  });

  it('matches Apple iPhone model families correctly including iPhone 17e, 16e, 15 Pro Max, and SE', () => {
    // Arrange
    const iphone17Entry = modelFamilyAuthorityTaxonomy.getEntry(
      'smartphones',
      'apple',
      'iphone-17'
    );
    const iphone16Entry = modelFamilyAuthorityTaxonomy.getEntry(
      'smartphones',
      'apple',
      'iphone-16'
    );
    const iphone15Entry = modelFamilyAuthorityTaxonomy.getEntry(
      'smartphones',
      'apple',
      'iphone-15'
    );
    const iphoneSeEntry = modelFamilyAuthorityTaxonomy.getEntry(
      'smartphones',
      'apple',
      'iphone-se'
    );

    // Assert entries exist and have expected minimum products
    expect(iphone17Entry).toMatchObject({
      displayName: 'iPhone 17 Series',
      minimumProducts: 3,
    });
    expect(iphone16Entry).toMatchObject({
      displayName: 'iPhone 16 Series',
      minimumProducts: 3,
    });
    expect(iphone15Entry).toMatchObject({
      displayName: 'iPhone 15 Series',
      minimumProducts: 3,
    });
    expect(iphoneSeEntry).toMatchObject({
      displayName: 'iPhone SE Series',
      minimumProducts: 2,
    });

    if (!iphone17Entry || !iphone16Entry || !iphone15Entry || !iphoneSeEntry) {
      throw new Error('Expected Apple iPhone entries');
    }

    // Matching assertions
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(iphone17Entry, 'iPhone 17e')
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(
        iphone17Entry,
        'Apple iPhone 17 Pro Max'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(iphone17Entry, 'iPhone 16')
    ).toBe(false);

    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(iphone16Entry, 'iPhone 16e')
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(
        iphone16Entry,
        'Apple iPhone 16 Plus'
      )
    ).toBe(true);

    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(
        iphone15Entry,
        'iPhone 15 Pro Max'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(
        iphone15Entry,
        'Apple iPhone 15'
      )
    ).toBe(true);

    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(iphoneSeEntry, 'iPhone SE')
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(
        iphoneSeEntry,
        'Apple iPhone SE 2022'
      )
    ).toBe(true);
  });
});

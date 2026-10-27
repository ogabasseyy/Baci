import { describe, expect, it } from 'vitest';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';

describe('model family authority taxonomy', () => {
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

  it('resolves distinct, non-overlapping Apple MacBook model families under laptops', () => {
    const laptopFamilies = modelFamilyAuthorityTaxonomy.getEntries(
      'laptops',
      'apple'
    );
    expect(laptopFamilies.map((f) => f.familyKey)).toEqual([
      'macbook-air',
      'macbook-pro',
    ]);

    const airEntry = modelFamilyAuthorityTaxonomy.getEntry(
      'laptops',
      'apple',
      'macbook-air'
    );
    const proEntry = modelFamilyAuthorityTaxonomy.getEntry(
      'laptops',
      'apple',
      'macbook-pro'
    );

    expect(airEntry).toMatchObject({
      displayName: 'MacBook Air',
      familyKey: 'macbook-air',
      minimumProducts: 3,
    });
    expect(proEntry).toMatchObject({
      displayName: 'MacBook Pro',
      familyKey: 'macbook-pro',
      minimumProducts: 3,
    });

    if (!airEntry || !proEntry) {
      throw new Error('Expected MacBook Air and Pro entries');
    }

    // MacBook Air matching
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(airEntry, 'MacBook Air 13 M2')
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(
        airEntry,
        '13" MacBook Air M4 (2025)'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(
        airEntry,
        'Apple MacBook Air M3'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(
        airEntry,
        'MacBook Pro 14 M3 Pro'
      )
    ).toBe(false);

    // MacBook Pro matching
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(
        proEntry,
        'MacBook Pro 14 M3 Pro'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(
        proEntry,
        '14" MacBook Pro M4 Pro (2024)'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(
        proEntry,
        'Apple MacBook Pro 16 M3 Max'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(proEntry, 'MacBook Air 15')
    ).toBe(false);

    // Neither
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(airEntry, 'MacBook 12')
    ).toBe(false);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(proEntry, 'MacBook 12')
    ).toBe(false);
  });
});

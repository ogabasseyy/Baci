import { describe, expect, it } from 'vitest';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';

describe('model family authority taxonomy', () => {
  it('does not match Samsung Galaxy A/S for competing-brand bare model codes', () => {
    const galaxyA = modelFamilyAuthorityTaxonomy.getEntry(
      'smartphones',
      'samsung',
      'galaxy-a'
    );
    const galaxyS = modelFamilyAuthorityTaxonomy.getEntry(
      'smartphones',
      'samsung',
      'galaxy-s'
    );
    if (!galaxyA || !galaxyS)
      throw new Error('Expected Samsung family entries');
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyA,
        'Samsung vs Itel A70: which should you buy?'
      )
    ).toBe(false);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyS,
        'Samsung vs Itel S23: which should you buy?'
      )
    ).toBe(false);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyA,
        'Tecno Spark A36 vs Samsung Galaxy S25'
      )
    ).toBe(false);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyS,
        'Tecno Camon S24 vs Samsung Galaxy A55'
      )
    ).toBe(false);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyA,
        'A78 vs Galaxy S24: Oppo vs Samsung shootout'
      )
    ).toBe(false);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyS,
        'Itel S24 vs Galaxy A55 compared'
      )
    ).toBe(false);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyA,
        'A55 vs A34: Which Samsung Mid-Ranger Wins?'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyS,
        'iPhone 16 vs Samsung S24'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyS,
        'Galaxy S Pen tips and tricks'
      )
    ).toBe(false);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyA,
        'Galaxy A new era of phones'
      )
    ).toBe(false);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyA,
        'Samsung Galaxy A55 review'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(galaxyS, 'Galaxy S24 review')
    ).toBe(true);
  });

  it('matches MacBook names with inch-prefixed sizes', () => {
    const air = modelFamilyAuthorityTaxonomy.getEntry(
      'laptops',
      'apple',
      'macbook-air'
    );
    const pro = modelFamilyAuthorityTaxonomy.getEntry(
      'laptops',
      'apple',
      'macbook-pro'
    );
    if (!air || !pro) throw new Error('Expected MacBook family entries');
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(air, '13-inch MacBook Air M2')
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(pro, '13.6-inch MacBook Pro')
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(air, 'MacBook Air 13-inch')
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(
        air,
        'Apple 13-inch MacBook Air M3'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(air, '2024 MacBook Air M3')
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesProduct(
        pro,
        '2024 Apple MacBook Pro 14'
      )
    ).toBe(true);
  });
});

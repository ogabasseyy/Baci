import { describe, expect, it } from 'vitest';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';

describe('model family authority taxonomy', () => {
  it('matches embedded model references in content while rejecting false positives', () => {
    const galaxyA = modelFamilyAuthorityTaxonomy.getEntry(
      'smartphones',
      'samsung',
      'galaxy-a'
    );
    const oppoA = modelFamilyAuthorityTaxonomy.getEntry(
      'smartphones',
      'oppo',
      'a-series'
    );
    const xiaomiT = modelFamilyAuthorityTaxonomy.getEntry(
      'smartphones',
      'xiaomi',
      'xiaomi-t'
    );
    const iphone17 = modelFamilyAuthorityTaxonomy.getEntry(
      'smartphones',
      'apple',
      'iphone-17'
    );

    if (!galaxyA || !oppoA || !xiaomiT || !iphone17) {
      throw new Error('Expected family entries');
    }

    // Valid embedded model references
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyA,
        'Samsung Galaxy A55 Review and Price in Nigeria'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyA,
        'Samsung A55 Camera and Performance Breakdown'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyA,
        'A55 vs A34: Which Samsung Mid-Ranger Wins?'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        oppoA,
        'Oppo A78 4G Review: Value for Money in Lagos'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        oppoA,
        'Oppo A-Series Buyer Guide for Students'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        xiaomiT,
        'Xiaomi 14T Pro Camera and Gaming Benchmark'
      )
    ).toBe(true);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        iphone17,
        'Apple iPhone 17 Pro Max Launch Expectations'
      )
    ).toBe(true);

    // False positive rejections (crucial regression safeguards)
    // 1. Galaxy AI must not match Galaxy A
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyA,
        'Galaxy AI Features: What You Need to Know in 2026'
      )
    ).toBe(false);

    // 1b. Apple chip names must not match Galaxy A
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyA,
        'iPhone 15 Pro vs Galaxy S24: A17 Pro vs Snapdragon'
      )
    ).toBe(false);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyA,
        'The A18 Bionic chip explained'
      )
    ).toBe(false);

    // 2. Unrelated Oppo text (e.g. Oppo Reno camera) must not match Oppo A-Series
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        oppoA,
        'Oppo Reno 12 Pro Camera and Portrait Shootout'
      )
    ).toBe(false);
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        oppoA,
        'Oppo Find X7 Ultra Display and Battery Review'
      )
    ).toBe(false);

    // 3. Isolated number 17 in title without iPhone 17 must not match iPhone 17 Series
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        iphone17,
        'iPhone buying guide: 17 tips for Nigerian shoppers'
      )
    ).toBe(false);

    // 4. Incomplete or unrelated 'T' token must not match Xiaomi T
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        xiaomiT,
        'Xiaomi phone tips and repair tutorial'
      )
    ).toBe(false);

    // 5. Competing brand models must not trigger false positive matches
    expect(
      modelFamilyAuthorityTaxonomy.matchesContent(
        galaxyA,
        'Oppo A78 vs Samsung Galaxy S24 Shootout'
      )
    ).toBe(false);

    const infinixNote = modelFamilyAuthorityTaxonomy.getEntry(
      'smartphones',
      'infinix',
      'note'
    );
    if (infinixNote) {
      expect(
        modelFamilyAuthorityTaxonomy.matchesContent(
          infinixNote,
          'Redmi Note 13 Pro Full Review'
        )
      ).toBe(false);
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { ModelFamilyAuthorityEntry } from '@/lib/storefront-category/category-hub-types';
import { modelFamilyAuthorityTaxonomy } from './model-family-authority-taxonomy';
import { modelFamilyContentMatching } from './model-family-content-matching';

function galaxyEntry(familyKey: 'galaxy-a' | 'galaxy-s') {
  const entry = modelFamilyAuthorityTaxonomy.getEntry(
    'smartphones',
    'samsung',
    familyKey
  );
  if (!entry) throw new Error(`Expected ${familyKey} entry`);
  return entry;
}

describe('modelFamilyContentMatching', () => {
  it('matches product names through model patterns', () => {
    const entry = galaxyEntry('galaxy-a');
    const productEntry: ModelFamilyAuthorityEntry = {
      ...entry,
      modelPatterns: [/^Galaxy A[0-9]/i],
    };
    expect(
      modelFamilyContentMatching.matchesProduct(productEntry, 'Galaxy A55')
    ).toBe(true);
    expect(
      modelFamilyContentMatching.matchesProduct(productEntry, 'Galaxy S24')
    ).toBe(false);
  });

  it('rejects bare model tokens owned by a rival brand', () => {
    expect(
      modelFamilyContentMatching.matchesContent(
        galaxyEntry('galaxy-a'),
        'Tecno Spark A36 vs Samsung Galaxy S25'
      )
    ).toBe(false);
    expect(
      modelFamilyContentMatching.matchesContent(
        galaxyEntry('galaxy-a'),
        'A78 vs Galaxy S24: Oppo vs Samsung shootout'
      )
    ).toBe(false);
  });

  it('accepts the nearest Samsung context before a bare token', () => {
    expect(
      modelFamilyContentMatching.matchesContent(
        galaxyEntry('galaxy-s'),
        'iPhone 16 vs Samsung S24'
      )
    ).toBe(true);
    expect(
      modelFamilyContentMatching.matchesContent(
        galaxyEntry('galaxy-a'),
        'A55 vs A34: Which Samsung Mid-Ranger Wins?'
      )
    ).toBe(true);
  });

  it('rejects non-model Galaxy phrases', () => {
    expect(
      modelFamilyContentMatching.matchesContent(
        galaxyEntry('galaxy-s'),
        'Galaxy S Pen tips and tricks'
      )
    ).toBe(false);
  });
});

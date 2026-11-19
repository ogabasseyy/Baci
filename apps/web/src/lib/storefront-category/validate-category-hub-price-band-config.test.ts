import { describe, expect, it } from 'vitest';
import {
  CATEGORY_HUB_DEFAULTS,
  CATEGORY_HUB_PRIORITY_CATEGORIES,
} from '@/config/category-hub-defaults';
import type { CategoryHubDefaults } from '@/lib/storefront-category/category-hub-types';
import type { PriceBandDefinition } from '@/lib/storefront-compare/compare-types';
import { CURATED_PRICE_BANDS } from '@/lib/storefront-compare/get-configured-price-bands';
import { validateCategoryHubPriceBandConfig } from './validate-category-hub-price-band-config';

const curatedBandsMap = CURATED_PRICE_BANDS as Record<
  string,
  PriceBandDefinition[]
>;
const categoryDefaultsMap = CATEGORY_HUB_DEFAULTS as Record<
  string,
  CategoryHubDefaults
>;

function makeTestDefaults(slugs: string[]): CategoryHubDefaults {
  return {
    intro: { heading: 'Test', description: 'Test desc' },
    trustFeatures: [],
    faqItems: [],
    bestFor: {},
    brandHighlights: { heading: 'Brands', description: 'Brands desc' },
    priceBands: slugs.map((slug) => ({
      slug,
      title: `Title ${slug}`,
      description: `Desc ${slug}`,
    })),
  };
}

describe('validateCategoryHubPriceBandConfig error branches', () => {
  it('throws when price bands exist in taxonomy but category has no defaults entry', () => {
    const testCategory = 'test-unconfigured-category';
    curatedBandsMap[testCategory] = [
      { slug: 'under-50k', label: 'Under 50k', ceiling: 50_000 },
    ];

    try {
      expect(() => validateCategoryHubPriceBandConfig(testCategory)).toThrow(
        `Category '${testCategory}' has price bands in taxonomy but no defaults entry`
      );
    } finally {
      delete curatedBandsMap[testCategory];
    }
  });

  it('safely returns without throwing when category has neither bands nor defaults', () => {
    expect(() =>
      validateCategoryHubPriceBandConfig('completely-unknown-category')
    ).not.toThrow();
  });

  it('throws when taxonomy contains duplicate price band slugs', () => {
    const testCategory = 'test-dup-taxonomy';
    curatedBandsMap[testCategory] = [
      { slug: 'under-50k', label: 'Under 50k', ceiling: 50_000 },
      { slug: 'under-50k', label: 'Under 50k dup', ceiling: 50_000 },
    ];
    categoryDefaultsMap[testCategory] = makeTestDefaults(['under-50k']);

    try {
      expect(() => validateCategoryHubPriceBandConfig(testCategory)).toThrow(
        `Category '${testCategory}' has duplicate price band slugs in taxonomy`
      );
    } finally {
      delete curatedBandsMap[testCategory];
      delete categoryDefaultsMap[testCategory];
    }
  });

  it('throws when copy defaults contain duplicate price band slugs', () => {
    const testCategory = 'test-dup-copy';
    curatedBandsMap[testCategory] = [
      { slug: 'under-50k', label: 'Under 50k', ceiling: 50_000 },
    ];
    categoryDefaultsMap[testCategory] = makeTestDefaults([
      'under-50k',
      'under-50k',
    ]);

    try {
      expect(() => validateCategoryHubPriceBandConfig(testCategory)).toThrow(
        `Category '${testCategory}' has duplicate price band slugs in copy defaults`
      );
    } finally {
      delete curatedBandsMap[testCategory];
      delete categoryDefaultsMap[testCategory];
    }
  });

  it('throws when a taxonomy slug is missing from copy defaults', () => {
    const testCategory = 'test-missing-slug';
    curatedBandsMap[testCategory] = [
      { slug: 'under-100k', label: 'Under 100k', ceiling: 100_000 },
    ];
    categoryDefaultsMap[testCategory] = makeTestDefaults(['under-200k']);

    try {
      expect(() => validateCategoryHubPriceBandConfig(testCategory)).toThrow(
        `Category '${testCategory}' taxonomy slug 'under-100k' is missing from copy defaults`
      );
    } finally {
      delete curatedBandsMap[testCategory];
      delete categoryDefaultsMap[testCategory];
    }
  });

  it('throws when copy defaults has extra slugs not in taxonomy (count mismatch)', () => {
    const testCategory = 'test-count-mismatch';
    curatedBandsMap[testCategory] = [
      { slug: 'under-100k', label: 'Under 100k', ceiling: 100_000 },
    ];
    categoryDefaultsMap[testCategory] = makeTestDefaults([
      'under-100k',
      'extra-band',
    ]);

    try {
      expect(() => validateCategoryHubPriceBandConfig(testCategory)).toThrow(
        `Category '${testCategory}' taxonomy slug count (1) does not match copy defaults slug count (2)`
      );
    } finally {
      delete curatedBandsMap[testCategory];
      delete categoryDefaultsMap[testCategory];
    }
  });

  it('validates every category in CATEGORY_HUB_PRIORITY_CATEGORIES', () => {
    for (const category of CATEGORY_HUB_PRIORITY_CATEGORIES) {
      expect(() => validateCategoryHubPriceBandConfig(category)).not.toThrow();
    }
  });
});

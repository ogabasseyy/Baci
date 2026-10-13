import { describe, expect, it } from 'vitest';
import { buildCompareGuideContexts } from './build-compare-guide-contexts';

describe('buildCompareGuideContexts', () => {
  it('keeps raw URL keys for loading and resolved slugs for scoring', () => {
    const contexts = buildCompareGuideContexts({
      supportedClusterCategory: 'smartphones',
      leftBrand: 'Apple',
      rightBrand: 'Samsung',
      leftName: 'iPhone 15',
      rightName: 'Galaxy S25',
      leftLoadSlug: 'iphone-15-key',
      rightLoadSlug: 'galaxy-s25-key',
      leftBuildSlug: 'iphone-15',
      rightBuildSlug: 'samsung-galaxy-s25',
    });

    expect(contexts).toEqual({
      guideLoadContext: {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Apple', 'Samsung'],
        productBrands: ['Apple', 'Samsung'],
        productNames: ['iPhone 15', 'Galaxy S25'],
        productSlugs: ['iphone-15-key', 'galaxy-s25-key'],
      },
      guideBuildContext: {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Apple', 'Samsung'],
        productBrands: ['Apple', 'Samsung'],
        productNames: ['iPhone 15', 'Galaxy S25'],
        productSlugs: ['iphone-15', 'samsung-galaxy-s25'],
      },
    });
  });

  it('returns no contexts for unsupported categories', () => {
    expect(
      buildCompareGuideContexts({
        supportedClusterCategory: null,
        leftBrand: 'Apple',
        rightBrand: 'Samsung',
        leftName: 'iPhone 15',
        rightName: 'Galaxy S25',
        leftLoadSlug: 'iphone-15',
        rightLoadSlug: 'galaxy-s25',
        leftBuildSlug: 'iphone-15',
        rightBuildSlug: 'galaxy-s25',
      })
    ).toEqual({ guideLoadContext: null, guideBuildContext: null });
  });

  it('keeps only the defined brand in both guide contexts', () => {
    const contexts = buildCompareGuideContexts({
      supportedClusterCategory: 'smartphones',
      leftBrand: null,
      rightBrand: 'Samsung',
      leftName: 'Galaxy S25',
      rightName: 'Galaxy S24',
      leftLoadSlug: 'galaxy-s25-key',
      rightLoadSlug: 'galaxy-s24-key',
      leftBuildSlug: 'samsung-galaxy-s25',
      rightBuildSlug: 'samsung-galaxy-s24',
    });

    expect(contexts.guideLoadContext?.brands).toEqual(['Samsung']);
    expect(contexts.guideBuildContext?.brands).toEqual(['Samsung']);
    expect(contexts.guideLoadContext?.productNames).toEqual([
      'Galaxy S25',
      'Galaxy S24',
    ]);
    expect(contexts.guideLoadContext?.productBrands).toEqual([null, 'Samsung']);
  });
});

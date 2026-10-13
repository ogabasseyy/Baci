import { describe, expect, it } from 'vitest';
import { getCompareProductMatchRequirements } from './get-compare-product-match-requirements';

describe('getCompareProductMatchRequirements variant preservation', () => {
  it('keeps storage discriminators for products with distinct identifiers', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productNames: ['Apple iPhone 15 Pro 256GB', 'Apple iPhone 16 128GB'],
    });

    expect(requirements).toEqual([
      {
        identifier: '15 pro',
        brand: 'apple',
        discriminatorTokens: ['256gb'],
      },
      {
        identifier: '16',
        brand: 'apple',
        discriminatorTokens: ['128gb'],
      },
    ]);
  });

  it('keeps shared and additional tokens for subset connectivity variants', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'tablets',
      brands: ['Apple'],
      productNames: ['Apple iPad 10 Wi-Fi', 'Apple iPad 10 Wi-Fi Cellular'],
    });

    expect(requirements).toEqual([
      {
        identifier: '10',
        brand: 'apple',
        discriminatorTokens: ['wifi'],
      },
      {
        identifier: '10',
        brand: 'apple',
        discriminatorTokens: ['wifi', 'cellular'],
      },
    ]);
  });

  it('merges aligned slug variants into display-name requirements', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productNames: ['Apple iPhone 15', 'Apple iPhone 16'],
      productSlugs: ['apple-iphone-15-256gb', 'apple-iphone-16-128gb'],
    });

    expect(requirements).toEqual([
      {
        identifier: '15',
        brand: 'apple',
        discriminatorTokens: ['256gb'],
      },
      {
        identifier: '16',
        brand: 'apple',
        discriminatorTokens: ['128gb'],
      },
    ]);
  });

  it('retains explicit color discriminators for same-model siblings', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productNames: ['Apple iPhone 15 Black', 'Apple iPhone 15 Blue'],
    });

    expect(requirements).toEqual([
      { identifier: '15', brand: 'apple', discriminatorTokens: ['black'] },
      { identifier: '15', brand: 'apple', discriminatorTokens: ['blue'] },
    ]);
  });

  it('retains shared storage with distinct colors for same-model siblings', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productNames: [
        'Apple iPhone 15 256GB Black',
        'Apple iPhone 15 256GB Blue',
      ],
    });

    expect(requirements).toEqual([
      {
        identifier: '15',
        brand: 'apple',
        discriminatorTokens: ['256gb', 'black'],
      },
      {
        identifier: '15',
        brand: 'apple',
        discriminatorTokens: ['256gb', 'blue'],
      },
    ]);
  });

  it('preserves small genuine storage variants in same-model comparisons', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productNames: ['Apple iPhone SE 16GB', 'Apple iPhone SE 32GB'],
    });

    expect(requirements).toEqual([
      { identifier: 'se', brand: 'apple', discriminatorTokens: ['16gb'] },
      { identifier: 'se', brand: 'apple', discriminatorTokens: ['32gb'] },
    ]);
  });

  it('preserves sole low-capacity Chromebook storage in comparisons', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'laptops',
      brands: ['Acer'],
      productNames: ['Acer Chromebook 311 32GB', 'Acer Chromebook 311 64GB'],
    });

    expect(requirements).toEqual([
      {
        identifier: 'chromebook 311',
        brand: 'acer',
        discriminatorTokens: ['32gb'],
      },
      {
        identifier: 'chromebook 311',
        brand: 'acer',
        discriminatorTokens: ['64gb'],
      },
    ]);
  });

  it('retains voltage discriminators for accessory comparisons', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'accessories',
      brands: ['Universal'],
      productNames: [
        'Universal Travel Adapter 110V',
        'Universal Travel Adapter 220V',
      ],
    });

    expect(requirements).toEqual([
      {
        identifier: 'travel adapter',
        brand: 'universal',
        discriminatorTokens: ['110v'],
      },
      {
        identifier: 'travel adapter',
        brand: 'universal',
        discriminatorTokens: ['220v'],
      },
    ]);
  });

  it('retains regions followed by variant metadata', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productNames: ['Apple iPhone 15 US 128GB', 'Apple iPhone 15 UK 128GB'],
    });

    expect(requirements).toEqual([
      {
        identifier: '15',
        brand: 'apple',
        discriminatorTokens: ['us', '128gb'],
      },
      {
        identifier: '15',
        brand: 'apple',
        discriminatorTokens: ['uk', '128gb'],
      },
    ]);
  });

  it('keeps proven numeric laptop families in compare identifiers', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'laptops',
      brands: ['Dell'],
      productNames: ['Dell XPS 13 9340', 'Dell XPS 14 9340'],
    });

    expect(requirements).toEqual([
      { identifier: 'xps 13 9340', brand: 'dell' },
      { identifier: 'xps 14 9340', brand: 'dell' },
    ]);
  });

  it('excludes laptop RAM while retaining aligned slug storage variants', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'laptops',
      brands: ['Dell'],
      productNames: ['Dell XPS 13 16GB', 'Dell XPS 14 32GB'],
      productSlugs: ['dell-xps-13-512gb', 'dell-xps-14-1tb'],
    });

    expect(requirements).toEqual([
      {
        identifier: 'xps 13',
        brand: 'dell',
        discriminatorTokens: ['512gb'],
      },
      {
        identifier: 'xps 14',
        brand: 'dell',
        discriminatorTokens: ['1tb'],
      },
    ]);
  });

  it('retains explicit laptop RAM variants in compare requirements', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'laptops',
      brands: ['Lenovo'],
      productNames: [
        'Lenovo ThinkPad T14 8GB RAM 512GB',
        'Lenovo ThinkPad T14 16GB RAM 512GB',
      ],
    });

    expect(requirements).toEqual([
      {
        identifier: 'thinkpad t14',
        brand: 'lenovo',
        discriminatorTokens: ['8gb', '512gb'],
      },
      {
        identifier: 'thinkpad t14',
        brand: 'lenovo',
        discriminatorTokens: ['16gb', '512gb'],
      },
    ]);
  });
});

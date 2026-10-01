import { describe, expect, it } from 'vitest';
import { getCompareProductMatchRequirements } from './get-compare-product-match-requirements';

describe('getCompareProductMatchRequirements', () => {
  it('returns no requirements when both product sources are empty', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      productNames: [],
      productSlugs: [],
    });

    expect(requirements).toEqual([]);
  });

  it('returns no requirements when one compared product has no model identifier', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      productNames: ['Apple iPhone 15', 'Samsung Smartphone'],
    });

    expect(requirements).toEqual([]);
  });

  it('keeps brand discriminators when compared models share an identifier', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartwatches',
      brands: ['Apple', 'Samsung'],
      productSlugs: ['apple-watch-ultra-49mm', 'samsung-watch-ultra'],
    });

    expect(requirements).toEqual([
      { identifier: 'watch ultra', brand: 'apple' },
      { identifier: 'watch ultra', brand: 'samsung' },
    ]);
  });

  it('retains occurrence discriminators for same-brand model variants', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productNames: [
        'Apple iPhone 15 6GB 128GB eSIM',
        'Apple iPhone 15 6GB 256GB physical SIM',
      ],
      productSlugs: [
        'apple-iphone-15-6gb-128gb-esim',
        'apple-iphone-15-6gb-256gb-physical-sim',
      ],
    });

    expect(requirements).toEqual([
      {
        identifier: '15',
        brand: 'apple',
        discriminatorTokens: ['128gb', 'esim'],
      },
      {
        identifier: '15',
        brand: 'apple',
        discriminatorTokens: ['256gb', 'physical', 'sim'],
      },
    ]);
  });

  it('normalizes split capacity units for same-model variants', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productNames: ['Apple iPhone 15 128 GB', 'Apple iPhone 15 256 GB'],
      productSlugs: [],
    });

    expect(requirements).toEqual([
      {
        identifier: '15',
        brand: 'apple',
        discriminatorTokens: ['128gb'],
      },
      {
        identifier: '15',
        brand: 'apple',
        discriminatorTokens: ['256gb'],
      },
    ]);
  });

  it('keeps cellular generations as same-model variant discriminators', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      brands: ['Samsung'],
      productNames: ['Samsung A15 5G 4GB 128GB', 'Samsung A15 LTE 4GB 128GB'],
      productSlugs: [],
    });

    expect(requirements).toEqual([
      {
        identifier: 'a15',
        brand: 'samsung',
        discriminatorTokens: ['5g', '128gb'],
      },
      {
        identifier: 'a15',
        brand: 'samsung',
        discriminatorTokens: ['lte', '128gb'],
      },
    ]);
  });

  it('canonicalizes hyphenated Wi-Fi as a same-model discriminator', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'tablets',
      brands: ['Apple'],
      productNames: [
        'Apple iPad Air 128GB Wi-Fi',
        'Apple iPad Air 128GB Cellular',
      ],
      productSlugs: [],
    });

    expect(requirements).toEqual([
      {
        identifier: 'air',
        brand: 'apple',
        discriminatorTokens: ['128gb', 'wifi'],
      },
      {
        identifier: 'air',
        brand: 'apple',
        discriminatorTokens: ['128gb', 'cellular'],
      },
    ]);
  });

  it('preserves source brands for distinct compare model phrases', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      productNames: ['Apple iPhone 15', 'Samsung Galaxy S25'],
    });

    expect(requirements).toEqual([
      { identifier: '15', brand: 'apple' },
      { identifier: 's25', brand: 'samsung' },
    ]);
  });

  it('canonicalizes configured alias brands before raw compare brands', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'playstation-5',
      brands: ['Sony', 'Microsoft'],
      productBrands: ['Sony', 'Microsoft'],
      productNames: ['Sony DualSense Edge', 'Microsoft Xbox Series X'],
    });

    expect(requirements.map(({ brand }) => brand)).toEqual([
      'playstation',
      'xbox',
    ]);
  });

  it('retains brands when nonnumeric model phrases collide by guide wording', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      productNames: ['Apple iPhone 14 Pro', 'Samsung Galaxy S25'],
    });

    expect(requirements).toEqual([
      { identifier: '14 pro', brand: 'apple' },
      { identifier: 's25', brand: 'samsung' },
    ]);
  });

  it('prefers a direct Xiaomi source brand over the overlapping Redmi alias', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      brands: ['Xiaomi', 'Samsung'],
      productNames: ['Xiaomi 14T', 'Samsung Galaxy S25'],
    });

    expect(requirements).toEqual([
      { identifier: '14t', brand: 'xiaomi' },
      { identifier: 's25', brand: 'samsung' },
    ]);
  });

  it('preserves duplicate requirements for color-only sibling variants', () => {
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

  it('uses aligned product brands when names and slugs omit the brand', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      brands: ['Apple', 'Nothing'],
      productBrands: ['Apple', 'Nothing'],
      productNames: ['iPhone 15', 'Phone 2'],
      productSlugs: ['iphone-15', 'phone-2'],
    });

    expect(requirements).toEqual([
      { identifier: '15', brand: 'apple' },
      { identifier: '2', brand: 'nothing' },
    ]);
  });

  it('uses a paired slug when a compare display name has no model', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      productNames: ['Apple iPhone 15', 'Samsung Smartphone'],
      productSlugs: ['apple-iphone-15', 'samsung-galaxy-s25'],
    });

    expect(requirements).toEqual([
      { identifier: '15', brand: 'apple' },
      { identifier: 's25', brand: 'samsung' },
    ]);
  });

  it('retains GPS and Bluetooth as compare discriminators', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartwatches',
      brands: ['Samsung'],
      productNames: ['Samsung Watch 9 GPS', 'Samsung Watch 9 BT'],
    });

    expect(requirements).toEqual([
      {
        identifier: 'watch 9',
        brand: 'samsung',
        discriminatorTokens: ['gps'],
      },
      {
        identifier: 'watch 9',
        brand: 'samsung',
        discriminatorTokens: ['bluetooth'],
      },
    ]);
  });

  it('retains monitor refresh rates as compare discriminators', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'monitors',
      brands: ['Samsung'],
      productNames: ['Samsung Odyssey G5 144Hz', 'Samsung Odyssey G5 240Hz'],
    });

    expect(requirements).toEqual([
      {
        identifier: 'odyssey g5',
        brand: 'samsung',
        discriminatorTokens: ['144hz'],
      },
      {
        identifier: 'odyssey g5',
        brand: 'samsung',
        discriminatorTokens: ['240hz'],
      },
    ]);
  });
});

import { generateSlug } from '@/lib/seo-utils';
import type { ModelFamilyAuthorityEntry } from '@/lib/storefront-category/category-hub-types';

declare module '@/lib/storefront-category/category-hub-types' {
  interface ModelFamilyAuthorityEntry {
    brandDisplayName?: string;
    brandSlug?: string;
    intro?: string;
    modelPatterns?: readonly RegExp[];
  }
}

const APPLE_IPHONE_MODEL_FAMILIES: readonly ModelFamilyAuthorityEntry[] = [
  {
    brandDisplayName: 'Apple iPhone',
    brandKey: 'apple',
    brandSlug: 'apple',
    categorySlug: 'smartphones',
    displayName: 'iPhone 17 Series',
    familyKey: 'iphone-17',
    intro:
      'Compare iPhone 17, iPhone 17e, iPhone 17 Air, iPhone 17 Pro, and iPhone 17 Pro Max options at {merchantName}.',
    minimumProducts: 3,
    modelPatterns: [/^(?:Apple\s+)?iPhone\s+17(?:e|\b)/i],
    productNamePattern: /^(?:Apple\s+)?iPhone\s+17(?:e|\b)/i,
  },
  {
    brandDisplayName: 'Apple iPhone',
    brandKey: 'apple',
    brandSlug: 'apple',
    categorySlug: 'smartphones',
    displayName: 'iPhone 16 Series',
    familyKey: 'iphone-16',
    intro:
      'Compare iPhone 16, iPhone 16e, iPhone 16 Plus, iPhone 16 Pro, and iPhone 16 Pro Max options at {merchantName}.',
    minimumProducts: 3,
    modelPatterns: [/^(?:Apple\s+)?iPhone\s+16(?:e|\b)/i],
    productNamePattern: /^(?:Apple\s+)?iPhone\s+16(?:e|\b)/i,
  },
  {
    brandDisplayName: 'Apple iPhone',
    brandKey: 'apple',
    brandSlug: 'apple',
    categorySlug: 'smartphones',
    displayName: 'iPhone 15 Series',
    familyKey: 'iphone-15',
    intro:
      'Compare iPhone 15, iPhone 15 Plus, iPhone 15 Pro, and iPhone 15 Pro Max options at {merchantName}.',
    minimumProducts: 3,
    modelPatterns: [/^(?:Apple\s+)?iPhone\s+15\b/i],
    productNamePattern: /^(?:Apple\s+)?iPhone\s+15\b/i,
  },
  {
    brandDisplayName: 'Apple iPhone',
    brandKey: 'apple',
    brandSlug: 'apple',
    categorySlug: 'smartphones',
    displayName: 'iPhone 14 Series',
    familyKey: 'iphone-14',
    intro:
      'Compare iPhone 14, iPhone 14 Plus, iPhone 14 Pro, and iPhone 14 Pro Max options at {merchantName}.',
    minimumProducts: 3,
    modelPatterns: [/^(?:Apple\s+)?iPhone\s+14\b/i],
    productNamePattern: /^(?:Apple\s+)?iPhone\s+14\b/i,
  },
  {
    brandDisplayName: 'Apple iPhone',
    brandKey: 'apple',
    brandSlug: 'apple',
    categorySlug: 'smartphones',
    displayName: 'iPhone 13 Series',
    familyKey: 'iphone-13',
    intro:
      'Compare iPhone 13, iPhone 13 Mini, iPhone 13 Pro, and iPhone 13 Pro Max options at {merchantName}.',
    minimumProducts: 3,
    modelPatterns: [/^(?:Apple\s+)?iPhone\s+13\b/i],
    productNamePattern: /^(?:Apple\s+)?iPhone\s+13\b/i,
  },
  {
    brandDisplayName: 'Apple iPhone',
    brandKey: 'apple',
    brandSlug: 'apple',
    categorySlug: 'smartphones',
    displayName: 'iPhone 12 Series',
    familyKey: 'iphone-12',
    intro:
      'Compare iPhone 12, iPhone 12 Mini, iPhone 12 Pro, and iPhone 12 Pro Max options at {merchantName}.',
    minimumProducts: 3,
    modelPatterns: [/^(?:Apple\s+)?iPhone\s+12\b/i],
    productNamePattern: /^(?:Apple\s+)?iPhone\s+12\b/i,
  },
  {
    brandDisplayName: 'Apple iPhone',
    brandKey: 'apple',
    brandSlug: 'apple',
    categorySlug: 'smartphones',
    displayName: 'iPhone 11 Series',
    familyKey: 'iphone-11',
    intro:
      'Compare iPhone 11, iPhone 11 Pro, and iPhone 11 Pro Max options at {merchantName}.',
    minimumProducts: 3,
    modelPatterns: [/^(?:Apple\s+)?iPhone\s+11\b/i],
    productNamePattern: /^(?:Apple\s+)?iPhone\s+11\b/i,
  },
  {
    brandDisplayName: 'Apple iPhone',
    brandKey: 'apple',
    brandSlug: 'apple',
    categorySlug: 'smartphones',
    displayName: 'iPhone SE Series',
    familyKey: 'iphone-se',
    intro:
      'Compare compact iPhone SE generations and configurations at {merchantName}.',
    minimumProducts: 2,
    modelPatterns: [/^(?:Apple\s+)?iPhone\s+SE\b/i],
    productNamePattern: /^(?:Apple\s+)?iPhone\s+SE\b/i,
  },
];

const MODEL_FAMILY_ENTRIES: readonly ModelFamilyAuthorityEntry[] = [
  ...APPLE_IPHONE_MODEL_FAMILIES,
  ...(
    [
      ['samsung', 'galaxy-a', 'Samsung Galaxy A', /^(?:Samsung )?Galaxy A/i],
      ['samsung', 'galaxy-s', 'Samsung Galaxy S', /^(?:Samsung )?Galaxy S/i],
      ['samsung', 'galaxy-z', 'Samsung Galaxy Z', /^(?:Samsung )?Galaxy Z/i],
      ['infinix', 'hot', 'Infinix HOT', /^(?:Infinix )?Hot/i, 2],
      ['infinix', 'note', 'Infinix Note', /^(?:Infinix )?Note/i],
      ['tecno', 'spark', 'Tecno Spark', /^(?:Tecno )?Spark/i],
      ['tecno', 'camon', 'Tecno Camon', /^(?:Tecno )?Camon/i],
      ['tecno', 'pop', 'Tecno Pop', /^(?:Tecno )?Pop/i],
      ['xiaomi', 'redmi-note', 'Redmi Note', /^(?:Xiaomi )?Redmi Note/i],
      ['xiaomi', 'redmi-a', 'Redmi A', /^(?:Xiaomi )?Redmi A/i],
      ['xiaomi', 'redmi-15', 'Redmi 15', /^(?:Xiaomi )?Redmi 15/i],
      ['xiaomi', 'xiaomi-t', 'Xiaomi T Series', /^(?:Xiaomi )?[0-9]+T/i],
      ['oppo', 'a-series', 'Oppo A Series', /^(?:Oppo\s+)?A(?=\s|\d)/i],
    ] as const
  ).map(
    ([
      brandKey,
      familyKey,
      displayName,
      productNamePattern,
      minimumProducts,
    ]) => ({
      brandKey,
      categorySlug: 'smartphones',
      displayName,
      familyKey,
      minimumProducts: minimumProducts ?? 3,
      productNamePattern,
    })
  ),
];

function getEntries(categorySlug: string, brandSlug: string) {
  const normalizedCategory = generateSlug(categorySlug);
  const normalizedBrand = generateSlug(brandSlug);
  return MODEL_FAMILY_ENTRIES.filter(
    (entry) =>
      entry.categorySlug === normalizedCategory &&
      (entry.brandKey === normalizedBrand ||
        (entry.brandSlug
          ? generateSlug(entry.brandSlug) === normalizedBrand
          : false))
  );
}

function getEntry(categorySlug: string, brandSlug: string, familySlug: string) {
  const normalizedFamily = generateSlug(familySlug);
  return (
    getEntries(categorySlug, brandSlug).find(
      (entry) => entry.familyKey === normalizedFamily
    ) ?? null
  );
}

function matchesProduct(entry: ModelFamilyAuthorityEntry, productName: string) {
  const trimmed = productName.trim();
  if (entry.modelPatterns && entry.modelPatterns.length > 0) {
    return entry.modelPatterns.some((pattern) => pattern.test(trimmed));
  }
  return entry.productNamePattern.test(trimmed);
}

export const modelFamilyAuthorityTaxonomy = {
  getEntries,
  getEntry,
  matchesProduct,
};

import { generateSlug } from '@/lib/seo-utils';
import type { ModelFamilyAuthorityEntry } from '@/lib/storefront-category/category-hub-types';

const MODEL_FAMILY_ENTRIES: readonly ModelFamilyAuthorityEntry[] = (
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
);

function getEntries(categorySlug: string, brandSlug: string) {
  const normalizedCategory = generateSlug(categorySlug);
  const normalizedBrand = generateSlug(brandSlug);
  return MODEL_FAMILY_ENTRIES.filter(
    (entry) =>
      entry.categorySlug === normalizedCategory &&
      entry.brandKey === normalizedBrand
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
  return entry.productNamePattern.test(productName.trim());
}

export const modelFamilyAuthorityTaxonomy = {
  getEntries,
  getEntry,
  matchesProduct,
};

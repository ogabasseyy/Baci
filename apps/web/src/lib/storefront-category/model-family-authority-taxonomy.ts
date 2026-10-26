import { generateSlug } from '@/lib/seo-utils';
import type { ModelFamilyAuthorityEntry } from '@/lib/storefront-category/category-hub-types';

declare module '@/lib/storefront-category/category-hub-types' {
  interface ModelFamilyAuthorityEntry {
    brandDisplayName?: string;
    brandSlug?: string;
    intro?: string;
    modelPatterns?: readonly RegExp[];
    embeddedPatterns?: readonly RegExp[];
  }
}

function makeIphone(
  familyKey: string,
  displayName: string,
  pat: RegExp,
  emb: RegExp,
  models: string,
  minimumProducts = 3
): ModelFamilyAuthorityEntry {
  return {
    brandDisplayName: 'Apple iPhone',
    brandKey: 'apple',
    brandSlug: 'apple',
    categorySlug: 'smartphones',
    displayName,
    embeddedPatterns: [emb],
    familyKey,
    intro:
      familyKey === 'iphone-se'
        ? 'Compare compact iPhone SE generations and configurations at {merchantName}.'
        : `Compare ${models} options at {merchantName}.`,
    minimumProducts,
    modelPatterns: [pat],
    productNamePattern: pat,
  };
}

function makeMacbook(
  familyKey: string,
  displayName: string,
  pattern: RegExp,
  embeddedPattern: RegExp
): ModelFamilyAuthorityEntry {
  return {
    brandDisplayName: 'Apple MacBook',
    brandKey: 'apple',
    brandSlug: 'apple',
    categorySlug: 'laptops',
    displayName,
    embeddedPatterns: [embeddedPattern],
    familyKey,
    minimumProducts: 3,
    modelPatterns: [pattern],
    productNamePattern: pattern,
  };
}

function fam(
  brandKey: string,
  familyKey: string,
  displayName: string,
  productNamePattern: RegExp,
  embeddedPatterns: readonly RegExp[],
  minimumProducts = 3
): ModelFamilyAuthorityEntry {
  return {
    brandKey,
    categorySlug: 'smartphones',
    displayName,
    embeddedPatterns,
    familyKey,
    minimumProducts,
    productNamePattern,
  };
}

const APPLE_IPHONE_MODEL_FAMILIES: readonly ModelFamilyAuthorityEntry[] = [
  makeIphone(
    'iphone-17',
    'iPhone 17 Series',
    /^(?:Apple\s+)?iPhone\s+17(?:e|\b)/i,
    /\b(?:Apple\s+)?iPhone\s+17(?:e|\b)/i,
    'iPhone 17, iPhone 17e, iPhone 17 Air, iPhone 17 Pro, and iPhone 17 Pro Max'
  ),
  makeIphone(
    'iphone-16',
    'iPhone 16 Series',
    /^(?:Apple\s+)?iPhone\s+16(?:e|\b)/i,
    /\b(?:Apple\s+)?iPhone\s+16(?:e|\b)/i,
    'iPhone 16, iPhone 16e, iPhone 16 Plus, iPhone 16 Pro, and iPhone 16 Pro Max'
  ),
  makeIphone(
    'iphone-15',
    'iPhone 15 Series',
    /^(?:Apple\s+)?iPhone\s+15\b/i,
    /\b(?:Apple\s+)?iPhone\s+15\b/i,
    'iPhone 15, iPhone 15 Plus, iPhone 15 Pro, and iPhone 15 Pro Max'
  ),
  makeIphone(
    'iphone-14',
    'iPhone 14 Series',
    /^(?:Apple\s+)?iPhone\s+14\b/i,
    /\b(?:Apple\s+)?iPhone\s+14\b/i,
    'iPhone 14, iPhone 14 Plus, iPhone 14 Pro, and iPhone 14 Pro Max'
  ),
  makeIphone(
    'iphone-13',
    'iPhone 13 Series',
    /^(?:Apple\s+)?iPhone\s+13\b/i,
    /\b(?:Apple\s+)?iPhone\s+13\b/i,
    'iPhone 13, iPhone 13 Mini, iPhone 13 Pro, and iPhone 13 Pro Max'
  ),
  makeIphone(
    'iphone-12',
    'iPhone 12 Series',
    /^(?:Apple\s+)?iPhone\s+12\b/i,
    /\b(?:Apple\s+)?iPhone\s+12\b/i,
    'iPhone 12, iPhone 12 Mini, iPhone 12 Pro, and iPhone 12 Pro Max'
  ),
  makeIphone(
    'iphone-11',
    'iPhone 11 Series',
    /^(?:Apple\s+)?iPhone\s+11\b/i,
    /\b(?:Apple\s+)?iPhone\s+11\b/i,
    'iPhone 11, iPhone 11 Pro, and iPhone 11 Pro Max'
  ),
  makeIphone(
    'iphone-se',
    'iPhone SE Series',
    /^(?:Apple\s+)?iPhone\s+SE\b/i,
    /\b(?:Apple\s+)?iPhone\s+SE\b/i,
    '',
    2
  ),
];

const APPLE_MACBOOK_MODEL_FAMILIES: readonly ModelFamilyAuthorityEntry[] = [
  makeMacbook(
    'macbook-air',
    'MacBook Air',
    /^(?:Apple\s+)?(?:[0-9]{2}(?:\.[0-9])?(?:["”']|[- ]inch)?\s+)?(?:Apple\s+)?MacBook\s+Air\b/i,
    /\b(?:Apple\s+)?MacBook\s+Air\b/i
  ),
  makeMacbook(
    'macbook-pro',
    'MacBook Pro',
    /^(?:Apple\s+)?(?:[0-9]{2}(?:\.[0-9])?(?:["”']|[- ]inch)?\s+)?(?:Apple\s+)?MacBook\s+Pro\b/i,
    /\b(?:Apple\s+)?MacBook\s+Pro\b/i
  ),
];

const MODEL_FAMILY_ENTRIES: readonly ModelFamilyAuthorityEntry[] = [
  ...APPLE_IPHONE_MODEL_FAMILIES,
  ...APPLE_MACBOOK_MODEL_FAMILIES,
  fam(
    'samsung',
    'galaxy-a',
    'Samsung Galaxy A',
    /^(?:Samsung )?(?:Galaxy )?A(?=\d|\s+\d|\s+(?:Series|Ultra|Plus|FE)\b|$)/i,
    [
      /\bGalaxy\s+A(?=\s|\d|$)/i,
      /(?:\b(?:Galaxy\s+|Samsung\s+(?:Galaxy\s+)?)A[0-9]{2}\b|(?:^|[.!?]\s*)(?:(?!\b(?:Apple|iPhone|Oppo|Redmi|Vivo|Tecno|Infinix|Itel|Xiaomi|Honor|Google|OnePlus)\b)[^.!?])*?\b(?:Samsung|Galaxy)\b(?:(?!\b(?:Apple|iPhone|Oppo|Redmi|Vivo|Tecno|Infinix|Itel|Xiaomi|Honor|Google|OnePlus)\b)[^.!?])*?\bA[0-9]{2}\b(?!\s+(?:Pro|Bionic|chip)\b)|(?:^|[.!?]\s*)(?:(?!\b(?:Apple|iPhone|Oppo|Redmi|Vivo|Tecno|Infinix|Itel|Xiaomi|Honor|Google|OnePlus)\b)[^.!?])*?\bA[0-9]{2}\b(?!\s+(?:Pro|Bionic|chip)\b)(?=[^.!?]*\b(?:Samsung|Galaxy)\b))/i,
    ]
  ),
  fam(
    'samsung',
    'galaxy-s',
    'Samsung Galaxy S',
    /^(?:Samsung )?(?:Galaxy )?S(?=\d|\s+\d|\s+(?:Ultra|Plus|FE)\b|$)/i,
    [
      /\bGalaxy\s+S(?=\s|\d|$)/i,
      /(?:\b(?:Galaxy\s+|Samsung\s+(?:Galaxy\s+)?)S[0-9]{2}\b|(?:^|[.!?]\s*)(?:(?!\b(?:Apple|iPhone|Oppo|Redmi|Vivo|Tecno|Infinix|Itel|Xiaomi|Honor|Google|OnePlus)\b)[^.!?])*?\b(?:Samsung|Galaxy)\b(?:(?!\b(?:Apple|iPhone|Oppo|Redmi|Vivo|Tecno|Infinix|Itel|Xiaomi|Honor|Google|OnePlus)\b)[^.!?])*?\bS[0-9]{2}\b|(?:^|[.!?]\s*)(?:(?!\b(?:Apple|iPhone|Oppo|Redmi|Vivo|Tecno|Infinix|Itel|Xiaomi|Honor|Google|OnePlus)\b)[^.!?])*?\bS[0-9]{2}\b(?=[^.!?]*\b(?:Samsung|Galaxy)\b))/i,
    ]
  ),
  fam(
    'samsung',
    'galaxy-z',
    'Samsung Galaxy Z',
    /^(?:Samsung )?(?:Galaxy )?Z(?=\s|\d|$)/i,
    [
      /\bGalaxy\s+Z(?=\s|\d|$)/i,
      /\b(?:Galaxy|Samsung)\s+Z\s*(?:Fold|Flip)[0-9]?\b/i,
    ]
  ),
  fam(
    'infinix',
    'hot',
    'Infinix HOT',
    /^(?:Infinix )?Hot(?=\s|\d|$)/i,
    [/\b(?:Infinix\s+)?Hot\s+[0-9]+\b/i, /\bInfinix\s+Hot\b/i],
    2
  ),
  fam('infinix', 'note', 'Infinix Note', /^(?:Infinix )?Note(?=\s|\d|$)/i, [
    /\bInfinix\s+Note\s+[0-9]+\b/i,
    /\bInfinix\s+Note\b/i,
  ]),
  fam('tecno', 'spark', 'Tecno Spark', /^(?:Tecno )?Spark(?=\s|\d|$)/i, [
    /\b(?:Tecno\s+)?Spark\s+[0-9]+\b/i,
    /\bTecno\s+Spark\b/i,
  ]),
  fam('tecno', 'camon', 'Tecno Camon', /^(?:Tecno )?Camon(?=\s|\d|$)/i, [
    /\b(?:Tecno\s+)?Camon\s+[0-9]+\b/i,
    /\bTecno\s+Camon\b/i,
  ]),
  fam('tecno', 'pop', 'Tecno Pop', /^(?:Tecno )?Pop(?=\s|\d|$)/i, [
    /\b(?:Tecno\s+)?Pop\s+[0-9]+\b/i,
    /\bTecno\s+Pop\b/i,
  ]),
  fam('tecno', 'phantom', 'Tecno Phantom', /^(?:Tecno )?Phantom(?=\s|\d|$)/i, [
    /\b(?:Tecno\s+)?Phantom\s+(?:X|V|[0-9])\b/i,
    /\bTecno\s+Phantom\b/i,
  ]),
  fam('itel', 'a-series', 'Itel A Series', /^(?:Itel )?A(?=\s|\d)/i, [
    /\bItel\s+A(?:-Series|\s+Series|\s+[0-9]{1,3}\b|[0-9]{1,3}\b)/i,
  ]),
  fam('itel', 's-series', 'Itel S Series', /^(?:Itel )?S(?=\s|\d)/i, [
    /\bItel\s+S(?:-Series|\s+Series|\s+[0-9]{1,3}\b|[0-9]{1,3}\b)/i,
  ]),
  fam('itel', 'p-series', 'Itel P Series', /^(?:Itel )?P(?=\s|\d)/i, [
    /\bItel\s+P(?:-Series|\s+Series|\s+[0-9]{1,3}\b|[0-9]{1,3}\b)/i,
  ]),
  fam(
    'xiaomi',
    'redmi-note',
    'Redmi Note',
    /^(?:Xiaomi )?Redmi Note(?=\s|\d|$)/i,
    [/\b(?:Xiaomi\s+)?Redmi\s+Note\b/i]
  ),
  fam('xiaomi', 'redmi-a', 'Redmi A', /^(?:Xiaomi )?Redmi A(?=\s|\d|$)/i, [
    /\b(?:Xiaomi\s+)?Redmi\s+A\b/i,
    /\bRedmi\s+A[0-9]+\b/i,
  ]),
  fam('xiaomi', 'redmi-15', 'Redmi 15', /^(?:Xiaomi )?Redmi 15/i, [
    /\b(?:Xiaomi\s+)?Redmi\s+15\b/i,
  ]),
  fam('xiaomi', 'xiaomi-t', 'Xiaomi T Series', /^(?:Xiaomi )?[0-9]+T/i, [
    /\b(?:Xiaomi\s+)?[0-9]{1,2}T\b/i,
  ]),
  fam('oppo', 'a-series', 'Oppo A Series', /^(?:Oppo\s+)?A(?=\s|\d)/i, [
    /\bOppo\s+A(?:-Series|\s+Series|\s+[0-9]{1,3}\b|[0-9]{1,3}\b)/i,
  ]),
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

function matchesContent(
  entry: ModelFamilyAuthorityEntry,
  content: string
): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }
  if (entry.embeddedPatterns && entry.embeddedPatterns.length > 0) {
    // Bound the scan: embedded patterns include tempered clauses whose
    // cost grows with input length, and model mentions live up front.
    const bounded = trimmed.slice(0, 1000);
    return entry.embeddedPatterns.some((pattern) => pattern.test(bounded));
  }
  return matchesProduct(entry, trimmed);
}

export const modelFamilyAuthorityTaxonomy = {
  getEntries,
  getEntry,
  matchesProduct,
  matchesContent,
};

import { generateSlug } from '@/lib/seo-utils';
import type { BrandAuthorityEntry } from '@/lib/storefront-category/category-hub-types';

function createBrandAuthorityEntry(
  categorySlug: string,
  brandKey: string,
  brandQueryValue: string,
  displayName: string,
  options?: {
    brandAliases?: string[];
    brandSlug?: string;
    intro?: string;
    minimumProducts?: number;
  }
): BrandAuthorityEntry {
  return {
    categorySlug,
    brandKey,
    brandQueryValue,
    displayName,
    minimumProducts: options?.minimumProducts ?? 5,
    ...(options?.brandAliases ? { brandAliases: options.brandAliases } : {}),
    ...(options?.brandSlug ? { brandSlug: options.brandSlug } : {}),
    ...(options?.intro ? { intro: options.intro } : {}),
  };
}

const BRAND_AUTHORITY_ENTRIES: readonly BrandAuthorityEntry[] = [
  // smartphones
  createBrandAuthorityEntry('smartphones', 'apple', 'Apple', 'Apple iPhone', {
    brandAliases: ['iPhone'],
    brandSlug: 'apple',
    intro:
      'Compare Apple iPhone smartphones at {merchantName} across Pro Max flagships, Pro models, base iPhones, and budget-friendly options.',
  }),
  createBrandAuthorityEntry('smartphones', 'samsung', 'Samsung', 'Samsung'),
  createBrandAuthorityEntry('smartphones', 'google', 'Google', 'Google Pixel'),
  createBrandAuthorityEntry('smartphones', 'infinix', 'Infinix', 'Infinix'),
  createBrandAuthorityEntry('smartphones', 'tecno', 'Tecno', 'Tecno'),
  createBrandAuthorityEntry('smartphones', 'itel', 'Itel', 'Itel'),
  createBrandAuthorityEntry(
    'smartphones',
    'xiaomi',
    'Xiaomi',
    'Xiaomi and Redmi',
    { brandAliases: ['Redmi'] }
  ),
  createBrandAuthorityEntry('smartphones', 'oppo', 'Oppo', 'Oppo'),
  createBrandAuthorityEntry('smartphones', 'honor', 'Honor', 'Honor'),

  // laptops
  createBrandAuthorityEntry('laptops', 'apple', 'Apple', 'Apple MacBook', {
    brandAliases: ['MacBook'],
    brandSlug: 'apple',
    intro:
      'Compare Apple MacBook Air and MacBook Pro laptops at {merchantName} across M-series and Intel configurations.',
  }),
  createBrandAuthorityEntry('laptops', 'hp', 'HP', 'HP'),
  createBrandAuthorityEntry('laptops', 'dell', 'Dell', 'Dell'),
  createBrandAuthorityEntry('laptops', 'lenovo', 'Lenovo', 'Lenovo'),

  // gaming-laptops
  createBrandAuthorityEntry('gaming-laptops', 'hp', 'HP', 'HP'),
  createBrandAuthorityEntry('gaming-laptops', 'dell', 'Dell', 'Dell', {
    brandAliases: ['Alienware'],
  }),
  createBrandAuthorityEntry('gaming-laptops', 'lenovo', 'Lenovo', 'Lenovo'),
  createBrandAuthorityEntry('gaming-laptops', 'msi', 'MSI', 'MSI'),
  createBrandAuthorityEntry('gaming-laptops', 'asus', 'ASUS', 'ASUS'),
  createBrandAuthorityEntry('gaming-laptops', 'acer', 'Acer', 'Acer'),

  // tablets
  createBrandAuthorityEntry('tablets', 'apple', 'Apple', 'Apple'),
  createBrandAuthorityEntry('tablets', 'samsung', 'Samsung', 'Samsung'),
  createBrandAuthorityEntry('tablets', 'xiaomi', 'Xiaomi', 'Xiaomi and Redmi', {
    brandAliases: ['Redmi'],
  }),

  // audio
  createBrandAuthorityEntry('audio', 'jbl', 'JBL', 'JBL'),
  createBrandAuthorityEntry('audio', 'riversong', 'Riversong', 'Riversong'),

  // smartwatches
  createBrandAuthorityEntry('smartwatches', 'apple', 'Apple', 'Apple'),
  createBrandAuthorityEntry('smartwatches', 'samsung', 'Samsung', 'Samsung'),

  // playstation-5
  createBrandAuthorityEntry(
    'playstation-5',
    'playstation',
    'PlayStation',
    'PlayStation',
    { brandAliases: ['PlayStation Studios'] }
  ),
];

function getBrandQueryValues(entry: BrandAuthorityEntry) {
  return [entry.brandQueryValue, ...(entry.brandAliases ?? [])];
}

function matchesBrand(entry: BrandAuthorityEntry, brand: string | null) {
  const normalizedBrand = generateSlug(brand ?? '');
  return getBrandQueryValues(entry).some(
    (queryValue) => generateSlug(queryValue) === normalizedBrand
  );
}

function getBrandAuthorityEntry(
  categorySlug: string,
  brandSlug: string
): BrandAuthorityEntry | null {
  const normalizedCategory = generateSlug(categorySlug);
  const normalizedBrand = generateSlug(brandSlug);

  return (
    BRAND_AUTHORITY_ENTRIES.find(
      (entry) =>
        entry.categorySlug === normalizedCategory &&
        (entry.brandKey === normalizedBrand ||
          (entry.brandSlug
            ? generateSlug(entry.brandSlug) === normalizedBrand
            : false))
    ) ?? null
  );
}

function getEligibleBrandAuthorityEntries(
  categorySlug: string,
  products: ReadonlyArray<{ brand?: string | null }>
): Array<BrandAuthorityEntry & { productCount: number }> {
  const normalizedCategory = generateSlug(categorySlug);

  return BRAND_AUTHORITY_ENTRIES.filter(
    (entry) => entry.categorySlug === normalizedCategory
  ).flatMap((entry) => {
    const productCount = products.filter((product) =>
      matchesBrand(entry, product.brand ?? null)
    ).length;

    return productCount >= entry.minimumProducts
      ? [{ ...entry, productCount }]
      : [];
  });
}

function getBrandAuthorityEntries(categorySlug: string) {
  const normalizedCategory = generateSlug(categorySlug);
  return BRAND_AUTHORITY_ENTRIES.filter(
    (entry) => entry.categorySlug === normalizedCategory
  );
}

function getSupportedBrandAuthorityCategories() {
  return Array.from(
    new Set(BRAND_AUTHORITY_ENTRIES.map((entry) => entry.categorySlug))
  );
}

function supportsBrandAuthorityCategory(categorySlug: string) {
  const normalizedCategory = generateSlug(categorySlug);
  return BRAND_AUTHORITY_ENTRIES.some(
    (entry) => entry.categorySlug === normalizedCategory
  );
}

export const brandAuthorityTaxonomy = {
  getBrandQueryValues,
  getEntries: getBrandAuthorityEntries,
  getEligibleEntries: getEligibleBrandAuthorityEntries,
  getEntry: getBrandAuthorityEntry,
  getSupportedCategories: getSupportedBrandAuthorityCategories,
  matchesBrand,
  supportsCategory: supportsBrandAuthorityCategory,
};

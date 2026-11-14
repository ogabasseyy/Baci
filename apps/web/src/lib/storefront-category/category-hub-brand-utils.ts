import { generateSlug } from '@/lib/seo-utils';
import { isNonBrandPlaceholderKey } from '@/lib/storefront-category/category-hub-brand-placeholder';
import type { CategoryHubProduct } from '@/lib/storefront-category/category-hub-types';

export {
  isNonBrandPlaceholderKey,
  NON_BRAND_PLACEHOLDER_KEYS,
} from '@/lib/storefront-category/category-hub-brand-placeholder';

export interface BrandCountEntry {
  key: string;
  label: string;
  count: number;
}

function normalizeBrand(brand?: string | null) {
  const label = brand?.trim();
  if (!label || isNonBrandPlaceholderKey(label)) {
    return null;
  }

  const key = generateSlug(label);
  if (!key || isNonBrandPlaceholderKey(key)) {
    return null;
  }

  return { key, label };
}

export function countBrandsByActiveProduct(products: CategoryHubProduct[]) {
  const counts = new Map<string, BrandCountEntry>();

  for (const product of products) {
    const normalizedBrand = normalizeBrand(product.brand);
    if (!normalizedBrand) {
      continue;
    }

    const existing = counts.get(normalizedBrand.key);
    if (existing) {
      existing.count += 1;
      continue;
    }

    counts.set(normalizedBrand.key, {
      key: normalizedBrand.key,
      label: normalizedBrand.label,
      count: 1,
    });
  }

  return [...counts.values()].sort(
    (left, right) =>
      right.count - left.count || left.label.localeCompare(right.label)
  );
}

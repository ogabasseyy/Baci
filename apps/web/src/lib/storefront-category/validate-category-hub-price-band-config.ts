import { CATEGORY_HUB_DEFAULTS } from '@/config/category-hub-defaults';
import { getConfiguredPriceBands } from '@/lib/storefront-compare/get-configured-price-bands';

export function validateCategoryHubPriceBandConfig(categorySlug: string): void {
  const bands = getConfiguredPriceBands(categorySlug);
  const priorityDefaults = Object.hasOwn(CATEGORY_HUB_DEFAULTS, categorySlug)
    ? CATEGORY_HUB_DEFAULTS[categorySlug as keyof typeof CATEGORY_HUB_DEFAULTS]
    : null;

  if (!priorityDefaults) {
    if (bands.length > 0) {
      throw new Error(
        `Category '${categorySlug}' has price bands in taxonomy but no defaults entry`
      );
    }
    return;
  }

  const taxonomySlugs = bands.map((band) => band.slug);
  const copySlugs = priorityDefaults.priceBands.map((entry) => entry.slug);

  const uniqueTaxonomySlugs = new Set(taxonomySlugs);
  if (uniqueTaxonomySlugs.size !== taxonomySlugs.length) {
    throw new Error(
      `Category '${categorySlug}' has duplicate price band slugs in taxonomy`
    );
  }

  const uniqueCopySlugs = new Set(copySlugs);
  if (uniqueCopySlugs.size !== copySlugs.length) {
    throw new Error(
      `Category '${categorySlug}' has duplicate price band slugs in copy defaults`
    );
  }

  for (const slug of uniqueTaxonomySlugs) {
    if (!uniqueCopySlugs.has(slug)) {
      throw new Error(
        `Category '${categorySlug}' taxonomy slug '${slug}' is missing from copy defaults`
      );
    }
  }

  if (uniqueTaxonomySlugs.size !== uniqueCopySlugs.size) {
    throw new Error(
      `Category '${categorySlug}' taxonomy slug count (${uniqueTaxonomySlugs.size}) does not match copy defaults slug count (${uniqueCopySlugs.size})`
    );
  }
}

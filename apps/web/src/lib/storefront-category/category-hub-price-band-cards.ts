import { CATEGORY_HUB_DEFAULTS } from '@/config/category-hub-defaults';
import { isProductAvailable } from '@/lib/storefront-category/category-hub-best-for-helpers';
import type {
  CategoryHubCard,
  CategoryHubProduct,
} from '@/lib/storefront-category/category-hub-types';
import { buildPriceBandCandidate } from '@/lib/storefront-compare/compare-eligibility';
import {
  getConfiguredPriceBands,
  getCuratedPriceBands,
  isPriceBandCurrencySupported,
} from '@/lib/storefront-compare/price-band-taxonomy';

export function validateCategoryHubPriceBandConfig(categorySlug: string): void {
  const bands = getConfiguredPriceBands(categorySlug);
  const priorityDefaults =
    CATEGORY_HUB_DEFAULTS[categorySlug as keyof typeof CATEGORY_HUB_DEFAULTS];

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

export function buildPriceBandCards(input: {
  categorySlug: string;
  storeUrl: string;
  products: CategoryHubProduct[];
  merchantCurrency?: string | null;
}): CategoryHubCard[] {
  if (
    !isPriceBandCurrencySupported(input.categorySlug, input.merchantCurrency)
  ) {
    return [];
  }

  const priorityDefaults =
    CATEGORY_HUB_DEFAULTS[
      input.categorySlug as keyof typeof CATEGORY_HUB_DEFAULTS
    ];
  if (!priorityDefaults) {
    return [];
  }

  try {
    validateCategoryHubPriceBandConfig(input.categorySlug);
  } catch {
    return [];
  }

  const curatedBands = getCuratedPriceBands(input.categorySlug, {
    merchantCurrency: input.merchantCurrency,
  });

  const availableProducts = input.products.filter(isProductAvailable);

  return curatedBands
    .map((band) => {
      const copy = priorityDefaults.priceBands.find(
        (entry) => entry.slug === band.slug
      );
      if (!copy) {
        return null;
      }

      const candidate = buildPriceBandCandidate({
        categorySlug: input.categorySlug,
        band,
        products: availableProducts,
      });

      if (!candidate.isIndexable) {
        return null;
      }

      return {
        title: copy.title,
        description: copy.description,
        href: `${input.storeUrl}/${input.categorySlug}/best-under/${band.slug}`,
      } satisfies CategoryHubCard;
    })
    .filter((card): card is CategoryHubCard => Boolean(card))
    .slice(0, 3);
}

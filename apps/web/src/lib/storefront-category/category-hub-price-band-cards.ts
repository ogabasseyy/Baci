import { CATEGORY_HUB_DEFAULTS } from '@/config/category-hub-defaults';
import type {
  CategoryHubCard,
  CategoryHubProduct,
} from '@/lib/storefront-category/category-hub-types';
import { isCategoryHubProductAvailable } from '@/lib/storefront-category/is-category-hub-product-available';
import { validateCategoryHubPriceBandConfig } from '@/lib/storefront-category/validate-category-hub-price-band-config';
import { buildPriceBandCandidate } from '@/lib/storefront-compare/compare-eligibility';
import { isPriceBandCurrencySupported } from '@/lib/storefront-compare/is-price-band-currency-supported';
import { getCuratedPriceBands } from '@/lib/storefront-compare/price-band-taxonomy';

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

  const priorityDefaults = Object.hasOwn(
    CATEGORY_HUB_DEFAULTS,
    input.categorySlug
  )
    ? CATEGORY_HUB_DEFAULTS[
        input.categorySlug as keyof typeof CATEGORY_HUB_DEFAULTS
      ]
    : null;
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

  const availableProducts = input.products.filter(
    isCategoryHubProductAvailable
  );

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

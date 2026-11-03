import { CATEGORY_HUB_DEFAULTS } from '@/config/category-hub-defaults';
import {
  compareByPriceAsc,
  compareBySpecDescThenPriceAsc,
  getSpecNumber,
  isProductAvailable,
  pickRepresentativeProduct,
} from '@/lib/storefront-category/category-hub-best-for-helpers';
import { buildExpansionBestForCards } from '@/lib/storefront-category/category-hub-expansion-best-for-cards';
import type {
  CategoryHubCard,
  CategoryHubProduct,
} from '@/lib/storefront-category/category-hub-types';
import { buildPriceBandCandidate } from '@/lib/storefront-compare/compare-eligibility';
import { getCuratedPriceBands } from '@/lib/storefront-compare/price-band-taxonomy';

export function buildBestForCards(input: {
  categorySlug: string;
  storeUrl: string;
  products: CategoryHubProduct[];
  merchantCurrency?: string | null;
}): CategoryHubCard[] {
  const availableProducts = input.products.filter(isProductAvailable);

  const makeCard = (
    title: string,
    description: string,
    products: CategoryHubProduct[],
    comparator: (left: CategoryHubProduct, right: CategoryHubProduct) => number
  ): CategoryHubCard | null => {
    const representative = pickRepresentativeProduct(products, comparator);
    if (!representative) return null;

    return {
      title,
      description,
      href: `${input.storeUrl}/${input.categorySlug}/${representative.slug}`,
    };
  };

  const getLowestBandProducts = () =>
    getCuratedPriceBands(input.categorySlug, {
      merchantCurrency: input.merchantCurrency,
    })
      .map((band) =>
        buildPriceBandCandidate({
          categorySlug: input.categorySlug,
          band,
          products: availableProducts,
        })
      )
      .find((candidate) => candidate.isIndexable)?.products ?? [];

  if (input.categorySlug === 'smartphones') {
    const priorityDefaults = CATEGORY_HUB_DEFAULTS.smartphones;
    const photography = availableProducts.filter(
      (p) => (getSpecNumber(p, 'main_camera_mp') ?? 0) >= 48
    );
    const battery = availableProducts.filter(
      (p) =>
        (getSpecNumber(p, 'battery_mah') ?? 0) >= 5000 ||
        (getSpecNumber(p, 'charging_watt') ?? 0) >= 45
    );
    return [
      makeCard(
        priorityDefaults.bestFor.photography.title,
        priorityDefaults.bestFor.photography.description,
        photography,
        compareBySpecDescThenPriceAsc('main_camera_mp')
      ),
      makeCard(
        priorityDefaults.bestFor.battery.title,
        priorityDefaults.bestFor.battery.description,
        battery,
        (left, right) =>
          (getSpecNumber(right, 'battery_mah') ?? 0) -
            (getSpecNumber(left, 'battery_mah') ?? 0) ||
          (getSpecNumber(right, 'charging_watt') ?? 0) -
            (getSpecNumber(left, 'charging_watt') ?? 0) ||
          left.price - right.price ||
          left.name.localeCompare(right.name) ||
          left.slug.localeCompare(right.slug)
      ),
      makeCard(
        priorityDefaults.bestFor.budget.title,
        priorityDefaults.bestFor.budget.description,
        getLowestBandProducts(),
        compareByPriceAsc
      ),
    ].filter((card): card is CategoryHubCard => Boolean(card));
  }

  if (input.categorySlug === 'laptops') {
    const priorityDefaults = CATEGORY_HUB_DEFAULTS.laptops;
    const workAndSchool = availableProducts.filter(
      (p) =>
        (getSpecNumber(p, 'ram_gb') ?? 0) >= 8 ||
        (getSpecNumber(p, 'storage_gb') ?? 0) >= 256
    );
    const performance = availableProducts.filter(
      (p) => (getSpecNumber(p, 'ram_gb') ?? 0) >= 16
    );
    return [
      makeCard(
        priorityDefaults.bestFor.workAndSchool.title,
        priorityDefaults.bestFor.workAndSchool.description,
        workAndSchool,
        (left, right) =>
          (getSpecNumber(right, 'ram_gb') ?? 0) -
            (getSpecNumber(left, 'ram_gb') ?? 0) ||
          (getSpecNumber(right, 'storage_gb') ?? 0) -
            (getSpecNumber(left, 'storage_gb') ?? 0) ||
          left.price - right.price ||
          left.name.localeCompare(right.name) ||
          left.slug.localeCompare(right.slug)
      ),
      makeCard(
        priorityDefaults.bestFor.performance.title,
        priorityDefaults.bestFor.performance.description,
        performance,
        compareBySpecDescThenPriceAsc('ram_gb')
      ),
      makeCard(
        priorityDefaults.bestFor.budget.title,
        priorityDefaults.bestFor.budget.description,
        getLowestBandProducts(),
        compareByPriceAsc
      ),
    ].filter((card): card is CategoryHubCard => Boolean(card));
  }

  if (input.categorySlug === 'smart-tvs') {
    const priorityDefaults = CATEGORY_HUB_DEFAULTS['smart-tvs'];
    const bigScreen = availableProducts.filter(
      (p) => (getSpecNumber(p, 'screen_size_inches') ?? 0) >= 55
    );
    const fastMotion = availableProducts.filter(
      (p) => (getSpecNumber(p, 'refresh_rate_hz') ?? 0) >= 120
    );
    return [
      makeCard(
        priorityDefaults.bestFor.bigScreenViewing.title,
        priorityDefaults.bestFor.bigScreenViewing.description,
        bigScreen,
        compareBySpecDescThenPriceAsc('screen_size_inches')
      ),
      makeCard(
        priorityDefaults.bestFor.fastMotion.title,
        priorityDefaults.bestFor.fastMotion.description,
        fastMotion,
        compareBySpecDescThenPriceAsc('refresh_rate_hz')
      ),
      makeCard(
        priorityDefaults.bestFor.budget.title,
        priorityDefaults.bestFor.budget.description,
        getLowestBandProducts(),
        compareByPriceAsc
      ),
    ].filter((card): card is CategoryHubCard => Boolean(card));
  }

  return buildExpansionBestForCards({
    categorySlug: input.categorySlug,
    storeUrl: input.storeUrl,
    availableProducts,
    merchantCurrency: input.merchantCurrency,
  });
}

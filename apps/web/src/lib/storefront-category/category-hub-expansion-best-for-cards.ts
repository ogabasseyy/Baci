import { CATEGORY_HUB_DEFAULTS } from '@/config/category-hub-defaults';
import type {
  CategoryHubCard,
  CategoryHubProduct,
} from '@/lib/storefront-category/category-hub-types';
import { compareByPriceAsc } from '@/lib/storefront-category/compare-by-price-asc';
import { compareBySpecDescThenPriceAsc } from '@/lib/storefront-category/compare-by-spec-desc-then-price-asc';
import { getCategoryHubSpecNumber } from '@/lib/storefront-category/get-category-hub-spec-number';
import { pickRepresentativeCategoryHubProduct } from '@/lib/storefront-category/pick-representative-category-hub-product';
import { isPriceBandCurrencySupported } from '@/lib/storefront-compare/price-band-taxonomy';

export function buildExpansionBestForCards(input: {
  categorySlug: string;
  storeUrl: string;
  availableProducts: CategoryHubProduct[];
  merchantCurrency?: string | null;
}): CategoryHubCard[] {
  const isNgn = isPriceBandCurrencySupported(
    input.categorySlug,
    input.merchantCurrency
  );

  const makeCard = (
    title: string,
    description: string,
    products: CategoryHubProduct[],
    comparator: (left: CategoryHubProduct, right: CategoryHubProduct) => number
  ): CategoryHubCard | null => {
    const representative = pickRepresentativeCategoryHubProduct(
      products,
      comparator
    );
    if (!representative) return null;

    return {
      title,
      description,
      href: `${input.storeUrl}/${input.categorySlug}/${representative.slug}`,
    };
  };

  if (input.categorySlug === 'gaming-laptops') {
    const priorityDefaults = CATEGORY_HUB_DEFAULTS['gaming-laptops'];
    const highMemory = input.availableProducts.filter(
      (p) => (getCategoryHubSpecNumber(p, 'ram_gb') ?? 0) >= 16
    );
    const under2m = isNgn
      ? input.availableProducts.filter((p) => p.price <= 2_000_000)
      : [];
    const largeScreen = input.availableProducts.filter(
      (p) => (getCategoryHubSpecNumber(p, 'screen_size_inches') ?? 0) >= 16
    );
    return [
      makeCard(
        priorityDefaults.bestFor.highMemory.title,
        priorityDefaults.bestFor.highMemory.description,
        highMemory,
        compareBySpecDescThenPriceAsc('ram_gb')
      ),
      isNgn
        ? makeCard(
            priorityDefaults.bestFor.under2m.title,
            priorityDefaults.bestFor.under2m.description,
            under2m,
            compareByPriceAsc
          )
        : null,
      makeCard(
        priorityDefaults.bestFor.largeScreen.title,
        priorityDefaults.bestFor.largeScreen.description,
        largeScreen,
        compareBySpecDescThenPriceAsc('screen_size_inches')
      ),
    ].filter((card): card is CategoryHubCard => Boolean(card));
  }

  if (input.categorySlug === 'tablets') {
    const priorityDefaults = CATEGORY_HUB_DEFAULTS.tablets;
    const budget = isNgn
      ? input.availableProducts.filter((p) => p.price <= 250_000)
      : [];
    const battery = input.availableProducts.filter(
      (p) => (getCategoryHubSpecNumber(p, 'battery_mah') ?? 0) >= 7000
    );
    const largeScreen = input.availableProducts.filter(
      (p) => (getCategoryHubSpecNumber(p, 'screen_size_inches') ?? 0) >= 10.9
    );
    return [
      isNgn
        ? makeCard(
            priorityDefaults.bestFor.budget.title,
            priorityDefaults.bestFor.budget.description,
            budget,
            compareByPriceAsc
          )
        : null,
      makeCard(
        priorityDefaults.bestFor.battery.title,
        priorityDefaults.bestFor.battery.description,
        battery,
        compareBySpecDescThenPriceAsc('battery_mah')
      ),
      makeCard(
        priorityDefaults.bestFor.largeScreen.title,
        priorityDefaults.bestFor.largeScreen.description,
        largeScreen,
        compareBySpecDescThenPriceAsc('screen_size_inches')
      ),
    ].filter((card): card is CategoryHubCard => Boolean(card));
  }

  if (input.categorySlug === 'audio') {
    if (!isNgn) return [];
    const priorityDefaults = CATEGORY_HUB_DEFAULTS.audio;
    return [
      makeCard(
        priorityDefaults.bestFor.budget.title,
        priorityDefaults.bestFor.budget.description,
        input.availableProducts.filter((p) => p.price <= 100_000),
        compareByPriceAsc
      ),
      makeCard(
        priorityDefaults.bestFor.midrange.title,
        priorityDefaults.bestFor.midrange.description,
        input.availableProducts.filter(
          (p) => p.price > 100_000 && p.price <= 500_000
        ),
        compareByPriceAsc
      ),
      makeCard(
        priorityDefaults.bestFor.premium.title,
        priorityDefaults.bestFor.premium.description,
        input.availableProducts.filter((p) => p.price > 500_000),
        compareByPriceAsc
      ),
    ].filter((card): card is CategoryHubCard => Boolean(card));
  }

  if (input.categorySlug === 'smartwatches') {
    if (!isNgn) return [];
    const priorityDefaults = CATEGORY_HUB_DEFAULTS.smartwatches;
    return [
      makeCard(
        priorityDefaults.bestFor.budget.title,
        priorityDefaults.bestFor.budget.description,
        input.availableProducts.filter((p) => p.price <= 150_000),
        compareByPriceAsc
      ),
      makeCard(
        priorityDefaults.bestFor.midrange.title,
        priorityDefaults.bestFor.midrange.description,
        input.availableProducts.filter(
          (p) => p.price > 150_000 && p.price <= 400_000
        ),
        compareByPriceAsc
      ),
      makeCard(
        priorityDefaults.bestFor.premium.title,
        priorityDefaults.bestFor.premium.description,
        input.availableProducts.filter((p) => p.price > 400_000),
        compareByPriceAsc
      ),
    ].filter((card): card is CategoryHubCard => Boolean(card));
  }

  if (input.categorySlug === 'playstation-5') {
    if (!isNgn) return [];
    const priorityDefaults = CATEGORY_HUB_DEFAULTS['playstation-5'];
    return [
      makeCard(
        priorityDefaults.bestFor.under50k.title,
        priorityDefaults.bestFor.under50k.description,
        input.availableProducts.filter((p) => p.price <= 50_000),
        compareByPriceAsc
      ),
      makeCard(
        priorityDefaults.bestFor.midTier.title,
        priorityDefaults.bestFor.midTier.description,
        input.availableProducts.filter(
          (p) => p.price > 50_000 && p.price <= 120_000
        ),
        compareByPriceAsc
      ),
      makeCard(
        priorityDefaults.bestFor.upperTier.title,
        priorityDefaults.bestFor.upperTier.description,
        input.availableProducts.filter((p) => p.price >= 400_000),
        compareByPriceAsc
      ),
    ].filter((card): card is CategoryHubCard => Boolean(card));
  }

  return [];
}

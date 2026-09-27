import type { FilterState } from '../components/CategoryFiltersSidebar';
import type { Product } from '../types';

export type CategoryPageColor =
  | string
  | {
      name?: string | null;
    };

export type AvailableFilterOptions = Record<
  keyof Omit<FilterState, 'minPrice' | 'maxPrice'>,
  string[]
>;

export function getCategoryProductColorName(
  color: CategoryPageColor
): string | null {
  return typeof color === 'string' ? color : color.name || null;
}

// Special collection routes whose products are NOT ordered by created_at
// (best-sellers → rating, on-sale → price, featured → updated_at), so the
// recently-added "Just in" carousel would mislabel them. (new-arrivals IS
// created_at-ordered, so it keeps the carousel.)
export const NON_RECENCY_COLLECTION_SLUGS = new Set([
  'best-sellers',
  'on-sale',
  'featured',
]);

export const INITIAL_CATEGORY_FILTER_STATE: FilterState = {
  brand: [],
  condition: [],
  storage: [],
  ram: [],
  graphics: [],
  colors: [],
  simType: [],
  displayType: [],
  displaySize: [],
  minPrice: 0,
  maxPrice: 0,
};

export const EMPTY_AVAILABLE_FILTER_OPTIONS: AvailableFilterOptions = {
  brand: [],
  condition: [],
  storage: [],
  ram: [],
  graphics: [],
  colors: [],
  simType: [],
  displayType: [],
  displaySize: [],
};

/**
 * Collect the distinct, sorted filter option values present in the current
 * category's product list. Returns empty options when client-side filtering is
 * disabled (server pre-paginated only a slice, so a client index would be
 * misleading).
 */
export function buildAvailableFilterOptions(
  products: Product[],
  canUseClientFilters: boolean
): AvailableFilterOptions {
  if (!canUseClientFilters) {
    return EMPTY_AVAILABLE_FILTER_OPTIONS;
  }

  const options = {
    brand: new Set<string>(),
    condition: new Set<string>(),
    storage: new Set<string>(),
    ram: new Set<string>(),
    graphics: new Set<string>(),
    colors: new Set<string>(),
    simType: new Set<string>(),
    displayType: new Set<string>(),
    displaySize: new Set<string>(),
  };

  products.forEach((p) => {
    if (p.brand) options.brand.add(p.brand);
    if (p.condition) options.condition.add(p.condition);
    if (p.storage) {
      if (Array.isArray(p.storage)) {
        p.storage.forEach((s) => {
          options.storage.add(s);
        });
      } else {
        options.storage.add(p.storage);
      }
    }
    if (p.ram) options.ram.add(p.ram);
    if (p.graphics) options.graphics.add(p.graphics);
    if (p.colors) {
      p.colors.forEach((color: CategoryPageColor) => {
        const colorName = getCategoryProductColorName(color);
        if (colorName) {
          options.colors.add(colorName);
        }
      });
    }
    if (p.simType) options.simType.add(p.simType);
    if (p.displayType) options.displayType.add(p.displayType);
    if (p.displaySize) options.displaySize.add(p.displaySize);
  });

  return {
    brand: Array.from(options.brand).sort(),
    condition: Array.from(options.condition).sort(),
    storage: Array.from(options.storage).sort(),
    ram: Array.from(options.ram).sort(),
    graphics: Array.from(options.graphics).sort(),
    colors: Array.from(options.colors).sort(),
    simType: Array.from(options.simType).sort(),
    displayType: Array.from(options.displayType).sort(),
    displaySize: Array.from(options.displaySize).sort(),
  };
}

/**
 * Apply the user's filter selection to the category products. OR logic within a
 * facet, AND logic between facets. Returns the products unchanged when
 * client-side filtering is disabled.
 */
export function filterCategoryProducts(
  products: Product[],
  filters: FilterState,
  canUseClientFilters: boolean
): Product[] {
  if (!canUseClientFilters) {
    return products;
  }

  return products.filter((p) => {
    // Price
    if (
      p.rawPrice &&
      (p.rawPrice < filters.minPrice ||
        (filters.maxPrice > 0 && p.rawPrice > filters.maxPrice))
    )
      return false;

    // Checkbox Filters (OR logic within category, AND logic between categories)
    if (
      filters.brand.length > 0 &&
      (!p.brand || !filters.brand.includes(p.brand))
    )
      return false;
    if (
      filters.condition.length > 0 &&
      (!p.condition || !filters.condition.includes(p.condition))
    )
      return false;
    if (filters.storage.length > 0) {
      const productStorage = (
        Array.isArray(p.storage) ? p.storage : [p.storage]
      ).filter((s): s is string => !!s);
      if (!productStorage.some((s) => filters.storage.includes(s)))
        return false;
    }
    if (filters.ram.length > 0 && (!p.ram || !filters.ram.includes(p.ram)))
      return false;
    if (
      filters.graphics.length > 0 &&
      (!p.graphics || !filters.graphics.includes(p.graphics))
    )
      return false;
    if (
      filters.simType.length > 0 &&
      (!p.simType || !filters.simType.includes(p.simType))
    )
      return false;
    if (
      filters.displayType.length > 0 &&
      (!p.displayType || !filters.displayType.includes(p.displayType))
    )
      return false;
    if (
      filters.displaySize.length > 0 &&
      (!p.displaySize || !filters.displaySize.includes(p.displaySize))
    )
      return false;

    // Colors: If product has ANY of the selected colors
    if (filters.colors.length > 0) {
      if (
        !p.colors?.some((color: CategoryPageColor) => {
          const colorName = getCategoryProductColorName(color);
          return colorName ? filters.colors.includes(colorName) : false;
        })
      )
        return false;
    }

    return true;
  });
}

/** Whether the user has narrowed the list with any active filter selection. */
export function hasActiveFilterSelection(
  filters: FilterState,
  canUseClientFilters: boolean
): boolean {
  return (
    canUseClientFilters &&
    (filters.brand.length > 0 ||
      filters.condition.length > 0 ||
      filters.storage.length > 0 ||
      filters.ram.length > 0 ||
      filters.graphics.length > 0 ||
      filters.colors.length > 0 ||
      filters.simType.length > 0 ||
      filters.displayType.length > 0 ||
      filters.displaySize.length > 0 ||
      filters.minPrice !== INITIAL_CATEGORY_FILTER_STATE.minPrice ||
      filters.maxPrice !== INITIAL_CATEGORY_FILTER_STATE.maxPrice)
  );
}

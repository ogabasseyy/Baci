'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FilterState } from '../components/CategoryFiltersSidebar';
import { buildCategoryGraphicsHref } from './build-category-graphics-href';
import { INITIAL_CATEGORY_FILTER_STATE } from './category-page-derivations';

interface UseServerCategoryGraphicsFilterOptions {
  availableGraphics: string[];
  basePath: string;
  categoryName: string;
  selectedGraphics: string[];
  /**
   * Curated hub slug this filter instance renders under. Transitions mint a
   * hub token so the listing can validate the selection against the hub's
   * facet set instead of applying the untrusted-request cap.
   */
  hubSlug?: string;
}

type NonGraphicsFilterState = Omit<FilterState, 'graphics'>;

function preserveNonGraphicsFilters(prev: FilterState): NonGraphicsFilterState {
  return {
    brand: prev.brand,
    colors: prev.colors,
    condition: prev.condition,
    displaySize: prev.displaySize,
    displayType: prev.displayType,
    maxPrice: prev.maxPrice,
    minPrice: prev.minPrice,
    ram: prev.ram,
    simType: prev.simType,
    storage: prev.storage,
  };
}

export function useServerCategoryGraphicsFilter({
  availableGraphics,
  basePath,
  categoryName,
  selectedGraphics,
  hubSlug,
}: UseServerCategoryGraphicsFilterOptions) {
  const router = useRouter();
  const [filters, setFilters] = useState<FilterState>(() => ({
    ...INITIAL_CATEGORY_FILTER_STATE,
    graphics: selectedGraphics,
  }));
  const filterScopeKey = `${categoryName}\u0000${selectedGraphics.join('\u0000')}`;
  const [previousFilterScopeKey, setPreviousFilterScopeKey] =
    useState(filterScopeKey);

  if (filterScopeKey !== previousFilterScopeKey) {
    setPreviousFilterScopeKey(filterScopeKey);
    // A new URL graphics selection must not discard local brand/price facet
    // state the shopper applied while the previous selection was active.
    setFilters((prev) => ({
      ...INITIAL_CATEGORY_FILTER_STATE,
      ...preserveNonGraphicsFilters(prev),
      graphics: selectedGraphics,
    }));
  }

  const enabled = availableGraphics.length > 0;
  // Page links must carry the validated hub token: without it, following a
  // page link from an over-cap hub transition drops back to the capped
  // selection and desynchronizes the listing from its metadata.
  const paginationPath = buildCategoryGraphicsHref({
    graphics: selectedGraphics,
    pathname: `${basePath}/${categoryName}`,
    trustedHubSlug: hubSlug,
  });

  // Always route graphics changes to the category listing path (the same
  // path backing paginationPath). window.location.pathname may be a graphics
  // hub (/gaming-laptops/graphics/[slug]) which ignores the ?graphics= query,
  // so navigating there would silently restore the hub selection.
  const categoryListingPath = `${basePath}/${categoryName}`;

  function navigate(graphics: string[]) {
    router.push(
      buildCategoryGraphicsHref({
        graphics,
        pathname: categoryListingPath,
        resetPage: true,
        search: window.location.search,
        trustedHubSlug: hubSlug,
      })
    );
  }

  function toggle(value: string, currentGraphics: string[]) {
    navigate(
      currentGraphics.includes(value)
        ? currentGraphics.filter((item) => item !== value)
        : [...currentGraphics, value]
    );
  }

  return {
    clear: () => navigate([]),
    enabled,
    filters,
    paginationPath,
    setFilters,
    toggle,
  };
}

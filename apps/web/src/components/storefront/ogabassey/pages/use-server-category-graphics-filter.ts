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
}

export function useServerCategoryGraphicsFilter({
  availableGraphics,
  basePath,
  categoryName,
  selectedGraphics,
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
    setFilters({
      ...INITIAL_CATEGORY_FILTER_STATE,
      graphics: selectedGraphics,
    });
  }

  const enabled = availableGraphics.length > 0;
  const paginationPath = buildCategoryGraphicsHref({
    graphics: selectedGraphics,
    pathname: `${basePath}/${categoryName}`,
  });

  function navigate(graphics: string[]) {
    router.push(
      buildCategoryGraphicsHref({
        graphics,
        pathname: window.location.pathname,
        resetPage: true,
        search: window.location.search,
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

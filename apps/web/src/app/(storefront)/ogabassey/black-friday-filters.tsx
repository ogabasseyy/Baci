'use client';

import { SlidersHorizontal } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import type { FilterState } from '@/components/storefront/ogabassey/components/CategoryFiltersSidebar';
import { INITIAL_CATEGORY_FILTER_STATE } from '@/components/storefront/ogabassey/pages/category-page-derivations';
import { BLACK_FRIDAY_PATH } from '@/config/ogabassey-black-friday';
import { asRoute } from '@/lib/routes';
import drawerStyles from './black-friday-filter-drawer.module.css';
import type { getBlackFridayLineupView } from './black-friday-lineup-view';
import styles from './ogabassey-black-friday-page.module.css';

const CategoryPageMobileFilterDrawer = dynamic(
  () =>
    import(
      '@/components/storefront/ogabassey/pages/category-page-mobile-filter-drawer'
    ).then((module) => module.CategoryPageMobileFilterDrawer),
  { loading: () => <p role="status">Loading filters…</p> }
);

const CategoryFiltersSidebar = dynamic(() =>
  import(
    '@/components/storefront/ogabassey/components/CategoryFiltersSidebar'
  ).then((module) => module.CategoryFiltersSidebar)
);

const desktopQuery = '(min-width: 64rem)';

function subscribeToDesktopWidth(onChange: () => void) {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function isDesktopWidth() {
  return window.matchMedia(desktopQuery).matches;
}

function serverDesktopWidth() {
  return false;
}

export function BlackFridayFilters({
  pathPrefix,
  count,
  selection,
}: {
  pathPrefix: string;
  count: number;
  selection: Omit<ReturnType<typeof getBlackFridayLineupView>, 'products'>;
}) {
  const router = useRouter();
  const isDesktop = useSyncExternalStore(
    subscribeToDesktopWidth,
    isDesktopWidth,
    serverDesktopWidth
  );
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(selection.filters);
  const [sort, setSort] = useState<string>(selection.sort);

  function updateFilter(section: keyof FilterState, value: string | number) {
    if (
      section !== 'minPrice' &&
      section !== 'maxPrice' &&
      typeof value === 'string'
    ) {
      setFilters((current) => ({
        ...current,
        [section]: current[section].includes(value)
          ? current[section].filter((option) => option !== value)
          : [...current[section], value],
      }));
    }
    if (
      (section === 'minPrice' || section === 'maxPrice') &&
      typeof value === 'number'
    ) {
      setFilters((current) => ({ ...current, [section]: Math.max(0, value) }));
    }
  }

  function applyFilters() {
    const params = new URLSearchParams();
    for (const [facet, values] of Object.entries(filters)) {
      if (Array.isArray(values)) {
        for (const value of values) params.append(facet, value);
      }
    }
    if (filters.minPrice) params.set('minPrice', String(filters.minPrice));
    if (filters.maxPrice) params.set('maxPrice', String(filters.maxPrice));
    if (sort) params.set('sort', sort);
    const query = params.size ? `?${params}` : '';
    setOpen(false);
    router.push(
      asRoute(`${pathPrefix}${BLACK_FRIDAY_PATH}${query}#black-friday-offers`)
    );
  }

  function clearFilters() {
    setFilters(INITIAL_CATEGORY_FILTER_STATE);
    setSort('');
  }

  const sortControl = (
    <div className={styles.filterForm}>
      <label>
        Sort by
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="">Featured</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
        </select>
      </label>
    </div>
  );

  return (
    <div>
      <aside
        className={styles.desktopFilters}
        aria-label="Filter Black Friday offers"
      >
        {isDesktop ? (
          <>
            <CategoryFiltersSidebar
              filters={filters}
              availableOptions={selection.availableOptions}
              onFilterChange={updateFilter}
              onClearFilters={clearFilters}
            />
            {sortControl}
            <button
              type="button"
              className={styles.applyFilters}
              onClick={applyFilters}
            >
              Apply filters
            </button>
          </>
        ) : null}
      </aside>
      <div className={styles.filters}>
        <button
          type="button"
          className={styles.filterTrigger}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          <span>Filter and sort</span>
          <span className={styles.offerCount}>
            {count} {count === 1 ? 'offer' : 'offers'}
          </span>
        </button>
        {open && !isDesktop ? (
          <CategoryPageMobileFilterDrawer
            filters={filters}
            availableOptions={selection.availableOptions}
            onFilterChange={updateFilter}
            onClearFilters={clearFilters}
            onClose={() => setOpen(false)}
            paginationProductCount={count}
            showPriceFilter
            className={drawerStyles.drawer}
            clearInHeader
            action={{ label: 'Apply filters', onClick: applyFilters }}
          >
            {sortControl}
          </CategoryPageMobileFilterDrawer>
        ) : null}
      </div>
    </div>
  );
}

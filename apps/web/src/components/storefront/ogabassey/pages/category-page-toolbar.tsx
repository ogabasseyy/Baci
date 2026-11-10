'use client';

import { ChevronRight, Filter, LayoutGrid, List } from 'lucide-react';
import Link from 'next/link';
import { asRoute } from '@/lib/routes';

interface CategoryPageToolbarProps {
  basePath: string;
  displayTitle: string;
  paginationProductCount: number;
  /** Demote when a parent route already committed the page H1. */
  titleHeading?: 'h1' | 'h2';
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  canShowFilters: boolean;
  onOpenMobileFilter: () => void;
}

/**
 * Breadcrumb, page heading, results count, grid/list toggle and the mobile
 * filter trigger. Extracted from CategoryPage as a presentational sub-component
 * (no derivation logic) to keep the page component under the 300-line budget.
 */
export function CategoryPageToolbar({
  basePath,
  displayTitle,
  paginationProductCount,
  titleHeading = 'h1',
  viewMode,
  onViewModeChange,
  canShowFilters,
  onOpenMobileFilter,
}: CategoryPageToolbarProps) {
  const Title = titleHeading === 'h2' ? 'h2' : 'h1';
  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-6 mb-6">
      <nav
        aria-label="Breadcrumb"
        className="overflow-x-auto whitespace-nowrap pb-2 text-sm text-store-background-text/65"
      >
        <ol className="flex items-center">
          <li>
            <Link
              href={asRoute(basePath || '/')}
              className="transition-colors hover:text-store-primary"
            >
              Home
            </Link>
          </li>
          <li className="flex items-center">
            <ChevronRight size={16} className="mx-2" aria-hidden="true" />
            <span
              aria-current="page"
              className="font-medium text-store-background-text"
            >
              {displayTitle}
            </span>
          </li>
        </ol>
      </nav>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <Title className="text-3xl md:text-4xl font-bold text-store-background-text">
            {displayTitle}
          </Title>
          <p className="text-store-background-text/70 text-sm mt-1">
            {paginationProductCount} results found
          </p>
        </div>

        {/* View Mode & Mobile Filter Toggle */}
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center bg-store-background rounded-lg p-1 border border-store-background-text/15">
            <button
              type="button"
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
              onClick={() => onViewModeChange('grid')}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center p-2 rounded-md transition-all ${viewMode === 'grid' ? 'bg-store-background-text/10 text-store-background-text shadow-sm' : 'text-store-background-text/60 hover:text-store-background-text/80'}`}
            >
              <LayoutGrid size={18} />
            </button>
            <button
              type="button"
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
              onClick={() => onViewModeChange('list')}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-store-background-text/10 text-store-background-text shadow-sm' : 'text-store-background-text/60 hover:text-store-background-text/80'}`}
            >
              <List size={18} />
            </button>
          </div>

          {canShowFilters && (
            <button
              type="button"
              onClick={onOpenMobileFilter}
              className="flex items-center gap-2 rounded-xl bg-store-primary px-4 py-2.5 text-sm font-bold text-store-primary-text shadow-md active:scale-95 md:hidden"
            >
              <Filter size={16} /> Filters
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

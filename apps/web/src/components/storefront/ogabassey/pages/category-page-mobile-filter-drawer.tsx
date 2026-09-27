'use client';

import { X } from 'lucide-react';
import {
  CategoryFiltersSidebar,
  type FilterState,
} from '../components/CategoryFiltersSidebar';
import type { AvailableFilterOptions } from './category-page-derivations';

interface CategoryPageMobileFilterDrawerProps {
  filters: FilterState;
  availableOptions: AvailableFilterOptions;
  onFilterChange: (section: keyof FilterState, value: string | number) => void;
  onClearFilters: () => void;
  onClose: () => void;
  paginationProductCount: number;
  showPriceFilter: boolean;
}

/**
 * Slide-in mobile filter drawer. Presentational: the parent owns the open/close
 * state and only mounts this when the drawer is open, so no visibility logic
 * lives here.
 */
export function CategoryPageMobileFilterDrawer({
  filters,
  availableOptions,
  onFilterChange,
  onClearFilters,
  onClose,
  paginationProductCount,
  showPriceFilter,
}: CategoryPageMobileFilterDrawerProps) {
  return (
    <div className="fixed inset-0 z-60 flex justify-end">
      <button
        type="button"
        aria-label="Close filters"
        className="absolute inset-0 bg-black/50 backdrop-blur-xs"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-xs bg-store-background h-full shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-filter-heading"
      >
        <div className="sticky top-0 bg-store-background z-10 px-5 py-4 border-b border-store-background-text/10 flex items-center justify-between">
          <h3
            id="mobile-filter-heading"
            className="font-bold text-lg text-store-background-text"
          >
            Filters
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-store-background-text/10 rounded-full"
            aria-label="Close filters"
          >
            <X size={24} className="text-store-background-text/50" />
          </button>
        </div>
        <div className="p-5 pb-24">
          <CategoryFiltersSidebar
            filters={filters}
            availableOptions={availableOptions}
            onFilterChange={onFilterChange}
            onClearFilters={onClearFilters}
            className="border-none shadow-none p-0"
            showPriceFilter={showPriceFilter}
          />
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-store-background border-t border-store-background-text/10">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-store-primary py-3 font-bold text-store-primary-text shadow-lg active:scale-95"
          >
            Show {paginationProductCount} Results
          </button>
        </div>
      </div>
    </div>
  );
}

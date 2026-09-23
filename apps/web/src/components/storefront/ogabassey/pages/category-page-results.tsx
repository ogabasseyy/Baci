'use client';

import { Filter } from 'lucide-react';
import React from 'react';
import { asRoute } from '@/lib/routes';
import { STOREFRONT_CRAWL_DISCOVERY_CATEGORY_PAGE_LIMIT } from '@/lib/storefront-pagination';
import { AdUnit } from '../components/AdUnit';
import {
  CategoryFiltersSidebar,
  type FilterState,
} from '../components/CategoryFiltersSidebar';
import { ProductCard } from '../components/ProductCard';
import { StorefrontPagination } from '../components/StorefrontPagination';
import type { Product } from '../types';
import type { AvailableFilterOptions } from './category-page-derivations';

// content-visibility reservations applied to product cards ONLY in FILTERED mode
// — the one unbounded render (ALL matching products on a single page, the
// long-task/INP tail). Paginated mode is bounded AND above-the-fold, so it
// passes '' (no content-visibility): first-screen cards must render eagerly and
// never be deferred.
//
// Values use the `auto` keyword form (`contain-intrinsic-size: auto <h>`) so the
// browser remembers each card's REAL height after first paint and only uses the
// fallback for never-yet-rendered cards (initial scrollbar estimate + first
// reveal). Contrast PR #3012, where a NON-auto over-reservation (250px vs 100px
// real) shrank on reveal and shifted (CLS up to 0.6); with `auto`, first-reveal
// deltas self-correct and slight over-reservation stays safe.
//
// Heights derived from the actual ProductCard layout (ProductCard.tsx):
//   GRID card = 1px border + p-3/md:p-4 + aspect-square image (width-driven)
//     + mb-3/md:mb-4 + title (2×20px, line-clamp-2) + [md only] description
//     (2×~19.5px) + price (~28px).
//     • mobile grid-cols-2 (~360–430px viewports → ~156–191px columns): image
//       ~130–165px → card ~250–290px  ⇒ reserve auto_300px.
//     • md+ grid-cols-3 (768px full-width → 1440px lg col-span-3 w/ sidebar):
//       image ~190–285px → card ~371–466px  ⇒ reserve auto_460px.
const FILTERED_GRID_CARD_CONTENT_VISIBILITY =
  'content-auto [contain-intrinsic-size:auto_300px] md:[contain-intrinsic-size:auto_460px]';
//   LIST row = 1px border + p-4 + max(aspect-square image, content stack).
//     • mobile: w-28 (112px) image; content (title + 3-line desc + button row)
//       drives ~180px  ⇒ reserve auto_190px.
//     • md+: w-48 (192px) image drives ~226px  ⇒ reserve auto_240px.
const FILTERED_LIST_CARD_CONTENT_VISIBILITY =
  'content-auto [contain-intrinsic-size:auto_190px] md:[contain-intrinsic-size:auto_240px]';

interface CategoryPageResultsProps {
  canShowFilters: boolean;
  showPriceFilter: boolean;
  filters: FilterState;
  availableOptions: AvailableFilterOptions;
  onFilterChange: (section: keyof FilterState, value: string | number) => void;
  onClearFilters: () => void;
  viewMode: 'grid' | 'list';
  visibleProducts: Product[];
  addedItems: string[];
  onAddToCart: (event: React.MouseEvent, product: Product) => void;
  hasKnownProducts: boolean;
  hasVisibleProducts: boolean;
  hasActiveFilters: boolean;
  filteredProductCount: number;
  pageStartIndex: number;
  visibleProductEndIndex: number;
  paginationProductCount: number;
  currentPageNumber: number;
  totalPages: number;
  pageTitle: string;
  categoryPath: string;
}

/**
 * Desktop filter sidebar, the product grid (with in-feed ads) and pagination.
 * A presentational sub-component of CategoryPage — all derivation logic stays
 * in the page; this only renders the pre-computed slices and callbacks.
 */
export function CategoryPageResults({
  canShowFilters,
  showPriceFilter,
  filters,
  availableOptions,
  onFilterChange,
  onClearFilters,
  viewMode,
  visibleProducts,
  addedItems,
  onAddToCart,
  hasKnownProducts,
  hasVisibleProducts,
  hasActiveFilters,
  filteredProductCount,
  pageStartIndex,
  visibleProductEndIndex,
  paginationProductCount,
  currentPageNumber,
  totalPages,
  pageTitle,
  categoryPath,
}: CategoryPageResultsProps) {
  // Filtered mode renders every matching product in one page (unbounded) — defer
  // offscreen card work with a correctly-sized reservation per view mode.
  // Paginated mode is bounded + above-the-fold, so cards get no reservation.
  const cardContentVisibilityClassName = hasActiveFilters
    ? viewMode === 'grid'
      ? FILTERED_GRID_CARD_CONTENT_VISIBILITY
      : FILTERED_LIST_CARD_CONTENT_VISIBILITY
    : '';

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-6">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar Filters (Desktop) */}
        {canShowFilters && (
          <div className="hidden lg:block lg:col-span-1">
            <div className="sticky top-24">
              <CategoryFiltersSidebar
                filters={filters}
                availableOptions={availableOptions}
                onFilterChange={onFilterChange}
                onClearFilters={onClearFilters}
                showPriceFilter={showPriceFilter}
              />
              <div className="mt-6">
                <AdUnit placementKey="PRODUCT_SIDEBAR" />
              </div>
            </div>
          </div>
        )}

        {/* Product Grid */}
        <div className={canShowFilters ? 'lg:col-span-3' : 'lg:col-span-4'}>
          {!hasKnownProducts ? (
            <div className="text-center py-20 bg-store-background rounded-2xl border border-store-background-text/10 shadow-sm">
              <div className="size-16 bg-store-background-text/5 rounded-full flex items-center justify-center mx-auto mb-4">
                <Filter className="text-store-background-text/40" size={32} />
              </div>
              <h3 className="text-lg font-bold text-store-background-text mb-1">
                No products found
              </h3>
              <p className="text-store-background-text/50 text-sm mb-6">
                Try adjusting your filters to find what you're looking for.
              </p>
              <button
                type="button"
                onClick={onClearFilters}
                className="font-bold text-store-primary hover:underline"
              >
                Clear all filters
              </button>
            </div>
          ) : hasVisibleProducts ? (
            <div
              className={
                viewMode === 'grid'
                  ? 'grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6'
                  : 'flex flex-col gap-4'
              }
            >
              {visibleProducts.map((product, index) => {
                const isAdded = addedItems.includes(String(product.id));
                return (
                  <React.Fragment key={product.id}>
                    <ProductCard
                      product={product}
                      onAddToCart={onAddToCart}
                      isAdded={isAdded}
                      viewMode={viewMode}
                      contentVisibilityClassName={cardContentVisibilityClassName}
                    />
                    {/* Ad insertion logic */}
                    {viewMode === 'grid' && (index === 5 || index === 11) && (
                      <div className="col-span-2 md:col-span-3 my-4">
                        <AdUnit placementKey="PRODUCT_GRID_IN_FEED" />
                      </div>
                    )}
                    {viewMode === 'list' && (index === 3 || index === 7) && (
                      <div className="w-full my-4">
                        <AdUnit placementKey="PRODUCT_GRID_IN_FEED" />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-20 bg-store-background rounded-2xl border border-store-background-text/10 shadow-sm">
              <div className="size-16 bg-store-background-text/5 rounded-full flex items-center justify-center mx-auto mb-4">
                <Filter className="text-store-background-text/40" size={32} />
              </div>
              <h3 className="text-lg font-bold text-store-background-text mb-1">
                Products on this page are temporarily unavailable.
              </h3>
              <p className="text-store-background-text/50 text-sm">
                Use the pagination links below to keep browsing available pages.
              </p>
            </div>
          )}

          {hasKnownProducts && (
            <div className="mt-8 space-y-3">
              {!hasActiveFilters && (
                <p className="text-center text-sm text-store-background-text/50">
                  {hasVisibleProducts
                    ? `Showing ${pageStartIndex + 1}-${visibleProductEndIndex} of ${paginationProductCount} products`
                    : `Page ${currentPageNumber} of ${totalPages}`}
                </p>
              )}

              {hasActiveFilters ? (
                <p className="text-center text-sm text-store-background-text/50">
                  Filtered results show all {filteredProductCount} matching
                  products on one page.
                </p>
              ) : (
                <StorefrontPagination
                  ariaLabel={`${pageTitle} pagination`}
                  basePath={asRoute(categoryPath)}
                  crawlDiscoveryAllPagesThreshold={
                    STOREFRONT_CRAWL_DISCOVERY_CATEGORY_PAGE_LIMIT
                  }
                  crawlDiscoveryLabel={`Browse more ${pageTitle} pages`}
                  crawlDiscoveryPageLabel={`${pageTitle} page`}
                  currentPage={currentPageNumber}
                  totalPages={totalPages}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

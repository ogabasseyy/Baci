'use client';
// Migrated from temp-source/components/CategoryPage.tsx
import { useParams, useRouter } from 'next/navigation';
import React, { type ReactNode, useEffect, useState } from 'react';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { STOREFRONT_PRODUCTS_PER_PAGE } from '@/lib/storefront-pagination';
import { yieldToScheduler } from '@/lib/yield-to-scheduler';
import type { FilterState } from '../components/CategoryFiltersSidebar';
import { CategoryRecentCarousel } from '../components/CategoryRecentCarousel';
import type { Product } from '../types';
import {
  buildAvailableFilterOptions,
  filterCategoryProducts,
  hasActiveFilterSelection,
  INITIAL_CATEGORY_FILTER_STATE,
  NON_RECENCY_COLLECTION_SLUGS,
} from './category-page-derivations';
import { CategoryPageMobileFilterDrawer } from './category-page-mobile-filter-drawer';
import { CategoryPageResults } from './category-page-results';
import { CategoryPageToolbar } from './category-page-toolbar';
import { toRelatedProductsProduct } from './product-details-page/related-product';

export interface CategorySEOProps {
  /**
   * Server-rendered category hub sections (intro, trust, cards, FAQ). Composed
   * in the RSC boundary (`category-page-content.tsx`) so `SafeHtml` — and thus
   * `sanitize-html` — stays out of this client component's bundle. Injected as
   * a ReactNode slot rather than imported here.
   */
  hubSections?: ReactNode;
  /** Products fetched from Supabase by the server page */
  products?: Product[];
  /** Optional category image URL from database */
  categoryImage?: string | null;
  currentPage?: number;
  itemsPerPage?: number;
  productsArePrePaginated?: boolean;
  /** Demote when a parent route already committed the page H1. */
  titleHeading?: 'h1' | 'h2';
  totalProductCount?: number;
}

export const CategoryPage: React.FC<CategorySEOProps> = ({
  hubSections,
  products = [],
  categoryImage,
  currentPage = 1,
  itemsPerPage = STOREFRONT_PRODUCTS_PER_PAGE,
  productsArePrePaginated = false,
  titleHeading = 'h1',
  totalProductCount,
}) => {
  const params = useParams();
  const categoryName = (params?.category || 'All') as string;
  // The raw URL slug (kebab-case, e.g. "best-sellers") — distinct from the
  // human-readable display title. Used for slug-based checks like the
  // non-recency collection gate below.
  const categorySlug =
    typeof params?.category === 'string' ? params.category : '';
  const _router = useRouter();
  const { addToCart } = useCart();
  const [addedItems, setAddedItems] = useState<string[]>([]);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const merchantContext = useMerchantSafe();
  const basePath = merchantContext?.basePath ?? '';
  const safeItemsPerPage =
    Number.isInteger(itemsPerPage) && itemsPerPage > 0
      ? itemsPerPage
      : STOREFRONT_PRODUCTS_PER_PAGE;
  const [filters, setFilters] = useState<FilterState>(
    INITIAL_CATEGORY_FILTER_STATE
  );

  // Reset filters inline during render when the category changes
  const [prevCategoryName, setPrevCategoryName] = useState(categoryName);
  if (categoryName !== prevCategoryName) {
    setPrevCategoryName(categoryName);
    setFilters(INITIAL_CATEGORY_FILTER_STATE);
  }

  // Scroll to top when category changes
  useEffect(() => {
    if (categoryName) {
      window.scrollTo(0, 0);
    }
  }, [categoryName]);

  useEffect(() => {
    if (!isMobileFilterOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMobileFilterOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isMobileFilterOpen]);

  // When the server pre-paginated only the current slice, a client-side filter
  // index would be misleading, so disable client filtering in that case.
  const hasPartialPrePaginatedProducts =
    productsArePrePaginated &&
    typeof totalProductCount === 'number' &&
    Number.isInteger(totalProductCount) &&
    totalProductCount > products.length;
  const canUseClientFilters = !hasPartialPrePaginatedProducts;

  const availableOptions = buildAvailableFilterOptions(
    products,
    canUseClientFilters
  );
  const filteredProducts = filterCategoryProducts(
    products,
    filters,
    canUseClientFilters
  );
  const hasActiveFilters = hasActiveFilterSelection(
    filters,
    canUseClientFilters
  );

  const explicitTotalProductCount =
    productsArePrePaginated &&
    typeof totalProductCount === 'number' &&
    Number.isInteger(totalProductCount) &&
    totalProductCount > filteredProducts.length
      ? totalProductCount
      : null;
  const usesPrePaginatedProducts =
    !hasActiveFilters && explicitTotalProductCount !== null;
  const paginationProductCount = usesPrePaginatedProducts
    ? explicitTotalProductCount
    : filteredProducts.length;
  const totalPages = Math.max(
    1,
    Math.ceil(paginationProductCount / safeItemsPerPage)
  );
  const currentPageNumber = hasActiveFilters
    ? 1
    : Math.min(Math.max(currentPage, 1), totalPages);
  const pageStartIndex = (currentPageNumber - 1) * safeItemsPerPage;
  const pageEndIndex = pageStartIndex + safeItemsPerPage;
  const visibleProducts = hasActiveFilters
    ? filteredProducts
    : usesPrePaginatedProducts
      ? filteredProducts
      : filteredProducts.slice(pageStartIndex, pageEndIndex);
  const hasKnownProducts = paginationProductCount > 0;
  const hasVisibleProducts = visibleProducts.length > 0;
  const visibleProductEndIndex = usesPrePaginatedProducts
    ? Math.min(pageStartIndex + visibleProducts.length, paginationProductCount)
    : Math.min(pageEndIndex, paginationProductCount);

  const handleFilterChange = async (
    section: keyof FilterState,
    value: string | number
  ) => {
    if (!canUseClientFilters) return;

    // The min/max price fields are controlled <input>s (value={filters.minPrice}
    // in CategoryFiltersSidebar). Deferring their state update across a
    // scheduler.yield() task boundary lets React restore the stale controlled
    // value between keystrokes, dropping/flickering typed characters — so commit
    // price edits synchronously.
    if (section === 'minPrice' || section === 'maxPrice') {
      setFilters((prev) => ({ ...prev, [section]: value }));
      return;
    }

    // Checkbox/grid filters re-render the whole product grid. Yield the main
    // thread first so the click/tap gets a paint before the synchronous filter
    // pass + grid re-render (INP presentation-delay fix; no-op where
    // scheduler.yield is absent).
    await yieldToScheduler();

    // Checkbox logic
    setFilters((prev) => {
      const list = prev[section] as string[];
      const valStr = value as string;
      if (list.includes(valStr)) {
        return { ...prev, [section]: list.filter((item) => item !== valStr) };
      }
      return { ...prev, [section]: [...list, valStr] };
    });
  };

  const handleAddToCart = (_e: React.MouseEvent, product: Product) => {
    addToCart(toRelatedProductsProduct(product), 1);

    const productId = String(product.id);
    setAddedItems((prev) => [...prev, productId]);
    setTimeout(() => {
      setAddedItems((prev) => prev.filter((id) => id !== productId));
    }, 2000);
  };

  // Clean display title for H1 and Breadcrumb (Koray-approved: no keyword stuffing)
  const displayTitle = (() => {
    if (categoryName === 'All') return 'All Products';

    return decodeURIComponent(categoryName)
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());
  })();

  const pageTitle = displayTitle;
  const categoryPath = `${basePath}/${categoryName}`;
  const clearFilters = () => setFilters(INITIAL_CATEGORY_FILTER_STATE);

  // Switching grid/list re-renders every ProductCard with a new layout — the
  // heaviest toggle on the page. Yield first so the click paints before it.
  const handleViewModeChange = async (mode: 'grid' | 'list') => {
    await yieldToScheduler();
    setViewMode(mode);
  };

  return (
    <div className="min-h-screen bg-[color-mix(in_srgb,var(--store-background,#ffffff)_94%,var(--store-background-text,#111827)_6%)] pb-20 pt-4">
      {/* Product-driven banner carousel of the most recently-added products in
          this category, replacing the static promo banner. When products are
          server-pre-paginated, `products` is only the current page's slice, so
          render the carousel only on the first page where the newest items are
          (otherwise it would surface page-local items, not the true recents). */}
      {!NON_RECENCY_COLLECTION_SLUGS.has(categorySlug.toLowerCase()) &&
        !(productsArePrePaginated && currentPage > 1) && (
          <CategoryRecentCarousel
            categoryImage={categoryImage}
            categoryName={displayTitle}
            // Key by the slug so the carousel remounts (resetting the active
            // slide) when navigating client-side between categories, instead of
            // reusing the previous category's index (e.g. the ad slide).
            key={categorySlug}
            products={products}
          />
        )}

      <CategoryPageToolbar
        basePath={basePath}
        displayTitle={displayTitle}
        paginationProductCount={paginationProductCount}
        titleHeading={titleHeading}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        canUseClientFilters={canUseClientFilters}
        onOpenMobileFilter={() => setIsMobileFilterOpen(true)}
      />

      <CategoryPageResults
        canUseClientFilters={canUseClientFilters}
        filters={filters}
        availableOptions={availableOptions}
        onFilterChange={handleFilterChange}
        onClearFilters={clearFilters}
        viewMode={viewMode}
        visibleProducts={visibleProducts}
        addedItems={addedItems}
        onAddToCart={handleAddToCart}
        hasKnownProducts={hasKnownProducts}
        hasVisibleProducts={hasVisibleProducts}
        hasActiveFilters={hasActiveFilters}
        filteredProductCount={filteredProducts.length}
        pageStartIndex={pageStartIndex}
        visibleProductEndIndex={visibleProductEndIndex}
        paginationProductCount={paginationProductCount}
        currentPageNumber={currentPageNumber}
        totalPages={totalPages}
        pageTitle={pageTitle}
        categoryPath={categoryPath}
      />

      {hubSections}

      {isMobileFilterOpen && canUseClientFilters && (
        <CategoryPageMobileFilterDrawer
          filters={filters}
          availableOptions={availableOptions}
          onFilterChange={handleFilterChange}
          onClearFilters={clearFilters}
          onClose={() => setIsMobileFilterOpen(false)}
          paginationProductCount={paginationProductCount}
        />
      )}
    </div>
  );
};

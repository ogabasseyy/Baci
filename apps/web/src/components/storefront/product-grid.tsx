'use client';

import { useEffect, useState } from 'react';
import { ProductGridSkeleton } from '@/components/ui/skeletons';
import { useStorefrontSafe } from '@/contexts/storefront-context';
import { useDebounce } from '@/hooks/use-debounce';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { apiGet } from '@/lib/api-client';
import { getSampleProductsForBusinessType, type Product } from '@/lib/products';
import { DidYouMeanBanner } from './did-you-mean-banner';
import { ProductGridCategoryPills } from './product-grid-category-pills';
import { ProductGridEmptyState } from './product-grid-empty-state';
import {
  ProductGridFilters,
  type ProductGridFilterType,
} from './product-grid-filters';
import { ProductGridHeading } from './product-grid-heading';
import { ProductGridItems } from './product-grid-items';
import { ProductGridSearchStatus } from './product-grid-search-status';
import { QuickViewModal, useQuickView } from './quick-view-modal';
import { usePreviewSearch } from './use-preview-search';
import { useProductGridCart } from './use-product-grid-cart';
import { useProductGridData } from './use-product-grid-data';

interface StorefrontProductGridProps {
  title?: string;
  columns?: number;
  limit?: number;
  showFilters?: boolean;
}

/** Latest server search response, keyed by the query that produced it. */
interface ServerSearchSnapshot {
  query: string;
  productIds: string[];
  didYouMean: string | null;
  error: string | null;
}

export function StorefrontProductGrid({
  title = 'Shop By',
  columns = 4,
  limit = 12,
  showFilters = false,
}: StorefrontProductGridProps) {
  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant || null;
  const { cartItemsMap, handleAddToCart, updateQuantity } = useProductGridCart(
    merchant?.slug
  );
  const storefrontContext = useStorefrontSafe();

  // Local state fallbacks for when context is missing (e.g. in builder)
  const [localSelectedCategory, setLocalSelectedCategory] = useState('All');
  const [localSearchQuery, setLocalSearchQuery] = useState('');

  const searchQuery = storefrontContext?.searchQuery ?? localSearchQuery;
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const selectedCategory =
    storefrontContext?.selectedCategory ?? localSelectedCategory;

  const handleSetSelectedCategory = (category: string) => {
    if (storefrontContext?.setSelectedCategory) {
      storefrontContext.setSelectedCategory(category);
    } else {
      setLocalSelectedCategory(category);
    }
  };

  const handleSetSearchQuery = (query: string) => {
    if (storefrontContext?.setSearchQuery) {
      storefrontContext.setSearchQuery(query);
    } else {
      setLocalSearchQuery(query);
    }
  };

  const isPreviewMode =
    !merchantContext ||
    merchant?.slug === 'preview-store' ||
    merchant?.id === 'preview-merchant-id' ||
    merchant?.id?.endsWith('-preview') ||
    merchant?.id?.startsWith('demo-');
  // Preview products are a pure derivation of the business type (stable
  // module-level samples); only fetched products live in state.
  const [fetchedProducts, setFetchedProducts] = useState<Product[]>([]);
  const products = isPreviewMode
    ? getSampleProductsForBusinessType(merchant?.business_type)
    : fetchedProducts;
  const [isLoading, setIsLoading] = useState(!isPreviewMode);
  const [filterType, setFilterType] =
    useState<ProductGridFilterType>('category');
  const [serverSearch, setServerSearch] = useState<ServerSearchSnapshot | null>(
    null
  );

  // Server-search values are derived from the latest snapshot, so clearing the
  // query needs no effect-driven state resets.
  const isServerSearchActive = Boolean(
    debouncedSearchQuery && merchant?.id && !isPreviewMode
  );
  const hasFreshServerSearch =
    isServerSearchActive && serverSearch?.query === debouncedSearchQuery;
  const serverSearchProductIds = hasFreshServerSearch
    ? (serverSearch?.productIds ?? [])
    : [];
  const didYouMean = isServerSearchActive
    ? (serverSearch?.didYouMean ?? null)
    : null;
  const isSearching = isServerSearchActive && !hasFreshServerSearch;
  const searchError = hasFreshServerSearch
    ? (serverSearch?.error ?? null)
    : null;

  useEffect(() => {
    if (isPreviewMode || !merchant?.id) {
      return;
    }

    const params = new URLSearchParams({
      merchant_id: merchant.id,
      compact: 'true',
      has_images: 'true',
    });

    // Fetch products
    apiGet<{ products: Product[] }>(
      `/api/storefront/products?${params}`,
      // Dashboard product creation must be visible immediately on storefronts;
      // do not let a browser cache serve the pre-creation product list here.
      { cache: 'no-store' }
    )
      .then((data) => {
        if (data.products) {
          setFetchedProducts(data.products);
        }
        setIsLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setIsLoading(false);
      });
  }, [merchant?.id, isPreviewMode]);

  useEffect(() => {
    if (!debouncedSearchQuery || !merchant?.id || isPreviewMode) {
      return;
    }

    let cancelled = false;
    apiGet<{ didYouMean: string | null; productIds: string[] }>(
      `/api/search?q=${encodeURIComponent(debouncedSearchQuery)}&merchant_id=${merchant.id}`
    )
      .then((data) => {
        if (cancelled) return;
        setServerSearch({
          query: debouncedSearchQuery,
          productIds: data.productIds || [],
          didYouMean: data.didYouMean || null,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Search error:', err);
        // Keep the last available results visible alongside the error message.
        setServerSearch((prev) => ({
          query: debouncedSearchQuery,
          productIds: prev?.productIds ?? [],
          didYouMean: prev?.didYouMean ?? null,
          error:
            err instanceof Error
              ? err.message
              : 'We could not refresh search results right now.',
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedSearchQuery, merchant?.id, isPreviewMode]);

  // Lazily built client search index, preview merchants only (see
  // use-preview-search): until it resolves — or when its chunk fails to
  // load — preview search falls back to the unfiltered list exactly as the
  // old null-index path did.
  const { fuse, searchFailed, retrySearch } = usePreviewSearch({
    // The storefront context types the query as optional; fall back to the
    // inactive empty query exactly as the old falsy guard did.
    debouncedSearchQuery: debouncedSearchQuery ?? '',
    // The optional-chaining derivation below can type as undefined; it was
    // only ever truthiness-checked, so normalize to a strict boolean.
    isPreviewMode: isPreviewMode ?? false,
    products,
  });

  // Filter options, category pills, and the final result list (see
  // use-product-grid-data); derivations are unchanged.
  const { categories, filterOptions, searchResults } = useProductGridData({
    debouncedSearchQuery,
    filterType,
    fuse,
    isPreviewMode,
    limit,
    navigationCategories: merchantContext?.navigationCategories,
    products,
    selectedCategory,
    serverSearchProductIds,
  });

  // Quick view modal state
  const {
    product: quickViewProduct,
    isOpen: isQuickViewOpen,
    openQuickView,
    closeQuickView,
  } = useQuickView();

  return (
    <section className="w-full py-8 md:py-12" id="products">
      <div className="container px-4 md:px-6">
        {showFilters ? (
          <ProductGridFilters
            filterType={filterType}
            filterOptions={filterOptions}
            selectedCategory={selectedCategory}
            onFilterTypeChange={setFilterType}
            onSelectCategory={handleSetSelectedCategory}
          />
        ) : (
          <>
            <ProductGridHeading title={title} />
            <ProductGridCategoryPills
              categories={categories}
              selectedCategory={selectedCategory}
              onSelectCategory={handleSetSelectedCategory}
            />
          </>
        )}
        <ProductGridSearchStatus
          searchError={searchError}
          debouncedSearchQuery={debouncedSearchQuery}
          showPreviewFailure={Boolean(isPreviewMode && searchFailed)}
          onRetrySearch={retrySearch}
          isLoading={isLoading}
          isSearching={isSearching}
          resultCount={searchResults.length}
          selectedCategory={selectedCategory}
        />
        {/* Did you mean banner */}
        {didYouMean && searchQuery && (
          <DidYouMeanBanner
            originalQuery={searchQuery}
            suggestion={didYouMean}
            onSuggestionClick={(suggestion) => {
              handleSetSearchQuery(suggestion);
            }}
          />
        )}

        {isLoading || isSearching ? (
          <ProductGridSkeleton
            count={limit}
            columns={columns as 2 | 3 | 4 | 5 | 6}
          />
        ) : searchResults.length > 0 ? (
          <ProductGridItems
            products={searchResults}
            columns={columns}
            cartItemsMap={cartItemsMap}
            basePath={merchantContext?.basePath ?? ''}
            onAddToCart={handleAddToCart}
            onUpdateQuantity={updateQuantity}
            onQuickView={openQuickView}
          />
        ) : (
          <ProductGridEmptyState
            searchQuery={searchQuery}
            selectedCategory={selectedCategory}
            filterType={filterType}
          />
        )}
      </div>

      {/* Quick View Modal */}
      <QuickViewModal
        product={quickViewProduct}
        isOpen={isQuickViewOpen}
        onClose={closeQuickView}
        merchantSlug={merchant?.slug}
        basePath={merchantContext?.basePath ?? ''}
      />
    </section>
  );
}

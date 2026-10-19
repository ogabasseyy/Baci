/**
 * Product Grid with instant client-side filtering
 * - All products loaded via SSR
 * - All filtering is purely client-side for instant response
 */

'use client';

import dynamic from 'next/dynamic';
import type { Route } from 'next';
import Link from 'next/link';
import React, { useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { deriveProductImageData } from '@baci/shared/lib';
import { prioritizeSmartphoneProducts } from '@baci/shared/storefront';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import type { Product as StorefrontProduct } from '@/lib/products';
import { storefrontProductFilters } from '@/lib/storefront-product-filters';
import { products as mockProducts } from '../data/products';
import { useV2Saved } from '../providers/v2-saved-context';
import type { Product } from '../types';
import { AdUnit } from './AdUnit';
import { useDeferredActivation } from './deferred-shell-feature';
import type { Particle } from './FloatingParticles';
import { ProductGridItem } from './ProductGridItem';

const DeferredAdvancedProductFilters = dynamic(
  () =>
    import('./AdvancedProductFilters').then(
      (mod) => mod.AdvancedProductFilters
    ),
  { loading: () => null }
);
const DeferredProductListItem = dynamic(
  () => import('./ProductListItem').then((mod) => mod.ProductListItem),
  { loading: () => null }
);
const DeferredFloatingParticles = dynamic(
  () => import('./FloatingParticles').then((mod) => mod.FloatingParticles),
  { loading: () => null }
);

const PRICE_FORMATTER = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function toTemplateProducts(storefrontProducts: StorefrontProduct[]): Product[] {
  return storefrontProducts.map((product) => {
    const formattedPrice = PRICE_FORMATTER.format(product.price);

    const {
      image,
      imageAlt,
      imagePayloads,
      images,
    } = deriveProductImageData({
      image: product.image,
      images: product.images ?? [],
    });

    const condition = storefrontProductFilters.getStorefrontConditionBadgeLabel({
      available_conditions: product.available_conditions,
      condition: product.condition,
      has_condition_offers: product.has_condition_offers,
    });

    const rawCategories = product.categories;
    const categoryObj = Array.isArray(rawCategories)
      ? rawCategories[0]
      : rawCategories;

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      price: formattedPrice,
      rawPrice: product.price,
      image,
      ...(imageAlt ? { image_alt: imageAlt } : {}),
      ...(imagePayloads.length > 0 ? { image_payloads: imagePayloads } : {}),
      description: product.description,
      rating: product.rating ?? 4.5,
      category: categoryObj?.name || product.category || 'General',
      category_id: product.category_id,
      categories: categoryObj,
      categorySlug: categoryObj?.slug || product.category_slug,
      condition,
      available_conditions: product.available_conditions,
      has_condition_offers: product.has_condition_offers,
      has_variants: product.has_variants,
      variant_model: product.variant_model,
      brand: product.brand,
      colors: product.colors,
      storage: product.storage_options?.[0],
      images,
      variants: product.variants,
    };
  });
}

interface EngineProductGridProps {
  storeSlug?: string;
  useMockData?: boolean;
  externalProducts?: StorefrontProduct[];
  templateProducts?: Product[];
  categories?: { name: string; slug: string }[];
  title?: string;
  showViewAll?: boolean;
  limit?: number;
  initialDisplayCount?: number;
  deferFilters?: boolean;
  inlineAdBreakpoints?: number[];
  deferItemChrome?: boolean;
}

export const EngineProductGrid: React.FC<EngineProductGridProps> = ({
  storeSlug,
  useMockData = false,
  externalProducts,
  templateProducts,
  categories: externalCategories,
  title = 'Featured Products',
  showViewAll = true,
  limit,
  initialDisplayCount,
  deferFilters = false,
  inlineAdBreakpoints,
  deferItemChrome = false,
}) => {
  const merchantContext = useMerchantSafe();
  const { addToCart, cart } = useCart();
  const { toggleSaved, isSaved } = useV2Saved();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawBase = merchantContext?.basePath ?? (storeSlug ? `/${storeSlug}` : '');
  const basePath = rawBase === '/' ? '' : rawBase;
  const allProductsHref = `${basePath}/products`;

  // All products from SSR
  const allProducts = (() => {
    if (useMockData) return mockProducts;
    if (templateProducts) return templateProducts;
    if (externalProducts) {
      return toTemplateProducts(externalProducts);
    }
    return [];
  })();

  // Filter state - always start with 'All' to avoid hydration mismatch
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedBrand, setSelectedBrand] = useState('All');
  const [selectedCondition, setSelectedCondition] = useState('All');
  const [minPrice, setMinPrice] = useState(0);
  const [maxPrice, setMaxPrice] = useState(100000000);
  const [minRating, setMinRating] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // UI state
  const [addedItems, setAddedItems] = useState<(number | string)[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);

  // Pagination: Load 20 products initially, then more on demand
  const PRODUCTS_PER_PAGE = 20;
  const startingDisplayCount = Math.max(
    1,
    initialDisplayCount ?? PRODUCTS_PER_PAGE
  );
  const [displayCount, setDisplayCount] = useState(startingDisplayCount);
  const shouldRenderFilters = useDeferredActivation({
    enabled: deferFilters,
    timeoutMs: 1200,
  });
  const adBreakpoints = inlineAdBreakpoints ?? [4, 8];

  // Categories from props
  const navCategories = merchantContext?.navigationCategories || [];
  const categoryList = externalCategories || navCategories;
  const categories = ['All', ...categoryList.map(c => c.name)];

  // Brands from all products (not filtered, so brand filter always shows all options)
  // PERFORMANCE OPTIMIZATION: Avoid intermediate array allocations (.map().filter())
  const brands = Array.from(
    (() => {
      const set = new Set<string>();
      for (const p of allProducts) {
        if (p.brand) set.add(p.brand);
      }
      return set;
    })()
  );

  // INSTANT client-side filtering - all filters applied in one computation
  // PERFORMANCE OPTIMIZATION: Replaced O(N*K) chained filters with O(N) single-pass filter + early return
  const filteredProducts = (() => {
    const result = [];

    for (const p of allProducts) {
      // Limit check (Early exit)
      if (limit && limit > 0 && result.length >= limit) {
        break;
      }

      // Category filter
      if (
        selectedCategory !== 'All' &&
        p.category?.toLowerCase() !== selectedCategory.toLowerCase()
      ) {
        continue;
      }

      // Brand filter
      if (selectedBrand !== 'All' && p.brand !== selectedBrand) {
        continue;
      }

      // Condition filter
      if (
        !storefrontProductFilters.matchesStorefrontConditionFilter(
          p,
          selectedCondition
        )
      ) {
        continue;
      }

      // Price filter
      const price = p.rawPrice || 0;
      if ((minPrice > 0 && price < minPrice) || (maxPrice < 100000000 && price > maxPrice)) {
        continue;
      }

      // Rating filter
      if (minRating > 0 && (p.rating || 0) < minRating) {
        continue;
      }

      result.push(p);
    }

    if (selectedCategory === 'All') {
      return prioritizeSmartphoneProducts(result);
    }

    return result;
  })();

  // Update URL when category changes (for sharing/bookmarking)
  const handleCategoryChange = (category: string) => {
    // Save scroll position before state change
    const scrollY = window.scrollY;

    setSelectedCategory(category);
    const newUrl = category === 'All'
      ? pathname
      : `${pathname}?category=${encodeURIComponent(category)}`;
    window.history.replaceState(null, '', newUrl);

    // Restore scroll position after React re-render
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollY);
    });
  };

  const handleResetFilters = () => {
    setSelectedCategory('All');
    setSelectedBrand('All');
    setSelectedCondition('All');
    setMinPrice(0);
    setMaxPrice(100000000);
    setMinRating(0);
    setDisplayCount(PRODUCTS_PER_PAGE);
    window.history.replaceState(null, '', pathname);
  };

  // Sync category filter from URL ?category= param during render (mount/navigation)
  // Use case-insensitive match to stay consistent with the product filtering logic
  // Compare the resolved category (a primitive) so unstable categoryList refs can't loop
  const urlCategory = searchParams.get('category');
  let urlSelectedCategory: string | null = null;
  if (urlCategory) {
    if (urlCategory.toLowerCase() === 'all') {
      urlSelectedCategory = 'All';
    } else {
      urlSelectedCategory =
        categoryList.find(
          (c) => c.name.toLowerCase() === urlCategory.toLowerCase()
        )?.name ?? null;
    }
  }
  const [prevUrlSelectedCategory, setPrevUrlSelectedCategory] = useState<
    string | null
  >(null);
  if (urlSelectedCategory !== prevUrlSelectedCategory) {
    setPrevUrlSelectedCategory(urlSelectedCategory);
    if (urlSelectedCategory !== null) {
      setSelectedCategory(urlSelectedCategory);
    }
  }

  // Reset pagination inline during render when filters change
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  const [prevFilters, setPrevFilters] = useState({
    maxPrice,
    minPrice,
    minRating,
    selectedBrand,
    selectedCategory,
    selectedCondition,
    startingDisplayCount,
  });
  if (
    prevFilters.maxPrice !== maxPrice ||
    prevFilters.minPrice !== minPrice ||
    prevFilters.minRating !== minRating ||
    prevFilters.selectedBrand !== selectedBrand ||
    prevFilters.selectedCategory !== selectedCategory ||
    prevFilters.selectedCondition !== selectedCondition ||
    prevFilters.startingDisplayCount !== startingDisplayCount
  ) {
    setPrevFilters({
      maxPrice,
      minPrice,
      minRating,
      selectedBrand,
      selectedCategory,
      selectedCondition,
      startingDisplayCount,
    });
    setDisplayCount(startingDisplayCount);
  }

  // Slice filtered products for pagination (unless limit is set by parent)
  const visibleProducts = limit ? filteredProducts : filteredProducts.slice(0, displayCount);
  const hasMoreProducts = !limit && displayCount < filteredProducts.length;

  const handleLoadMore = () => {
    setDisplayCount((prev) => prev + PRODUCTS_PER_PAGE);
  };

  const handleAddToCart = (e: React.MouseEvent, product: Product) => {
    e.preventDefault();
    e.stopPropagation();
    if (addToCart(product as any, 1) === 'rejected') {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const particleId = Date.now() + Math.random();
    setParticles(prev => [...prev, { id: particleId, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }]);
    setTimeout(() => setParticles(prev => prev.filter(p => p.id !== particleId)), 1000);

    setAddedItems(prev => [...prev, product.id]);
    setTimeout(() => setAddedItems(prev => prev.filter(id => id !== product.id)), 2000);
  };

  const getCartQuantity = (productId: number | string): number => {
    return cart.find(item => String(item.id) === String(productId))?.quantity || 0;
  };

  // Show skeleton only if no products loaded from SSR
  if (allProducts.length === 0) {
    return (
      <div className="max-w-[1400px] mx-auto px-3 md:px-6 pt-6 md:pt-8 pb-20">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6" />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6">
            {[...Array(8)].map((_, i) => (
              <div key={`skeleton-${i}`} className="bg-gray-200 rounded-xl aspect-square" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-screen">
      {!deferFilters || shouldRenderFilters ? (
        <DeferredAdvancedProductFilters
          categories={categories}
          selectedCategory={selectedCategory}
          onSelectCategory={handleCategoryChange}
          minPrice={minPrice}
          maxPrice={maxPrice}
          onPriceChange={(min, max) => { setMinPrice(min); setMaxPrice(max); }}
          brands={brands}
          selectedBrand={selectedBrand}
          onSelectBrand={setSelectedBrand}
          selectedCondition={selectedCondition}
          onSelectCondition={setSelectedCondition}
          minRating={minRating}
          onSelectRating={setMinRating}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      ) : (
        <section className="bg-white border-b border-gray-100 sticky top-0 z-40 shadow-sm transition-all duration-300">
          <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-3">
            <div className="h-12 rounded-2xl bg-gray-100/90 animate-pulse" />
          </div>
        </section>
      )}

      <section className="max-w-[1400px] mx-auto px-3 md:px-6 py-6 md:py-8 relative">
        <div className="flex items-center justify-between mb-6 md:mb-8">
          <div>
            {title === 'Featured Products' && (
              <span className="text-store-primary font-bold uppercase tracking-wider text-xs md:text-sm">
                Best Sellers
              </span>
            )}
            <h2 className="mt-1 text-xl font-bold text-white md:text-3xl">
              {title}
            </h2>
          </div>
          {showViewAll && (
            <Link
              href={allProductsHref as Route}
              prefetch={false}
              className="hidden text-xs font-medium text-white/70 transition-colors hover:text-white md:text-base sm:block"
            >
              View all products
            </Link>
          )}
        </div>

        {filteredProducts.length === 0 ? (
          <div className="text-center py-20 bg-gray-50 rounded-2xl border border-gray-100">
            <p className="text-gray-500 text-lg">No products found matching your filters.</p>
            <button onClick={handleResetFilters} className="mt-4 text-red-600 font-semibold hover:underline" type="button">
              Reset Filters
            </button>
          </div>
        ) : (
          <div
            className={viewMode === 'grid'
              ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6'
              : 'flex flex-col gap-3 md:gap-4'}
          >
            {visibleProducts.map((product, index) => {
              const isAdded = addedItems.includes(product.id);
              const isWishlisted = isSaved(String(product.id));

              return (
                <React.Fragment key={product.id}>
                  {viewMode === 'grid' ? (
                    <ProductGridItem
                      basePath={basePath}
                      product={product}
                      onAddToCart={handleAddToCart}
                      isAdded={isAdded}
                      cartQuantity={getCartQuantity(product.id)}
                      viewMode="grid"
                      isWishlisted={isWishlisted}
                      onToggleWishlist={(e) => { e.preventDefault(); toggleSaved(product); }}
                      deferInteractiveChrome={deferItemChrome}
                    />
                  ) : (
                    <>
                      <div className="block md:hidden">
                        <ProductGridItem
                          basePath={basePath}
                          product={product}
                          onAddToCart={handleAddToCart}
                          isAdded={isAdded}
                          cartQuantity={getCartQuantity(product.id)}
                          viewMode="list"
                          isWishlisted={isWishlisted}
                          onToggleWishlist={(e) => { e.preventDefault(); toggleSaved(product); }}
                          deferInteractiveChrome={deferItemChrome}
                        />
                      </div>
                      <div className="hidden md:block">
                        <DeferredProductListItem
                          basePath={basePath}
                          product={product}
                          onAddToCart={handleAddToCart}
                          isAdded={isAdded}
                          isWishlisted={isWishlisted}
                          onToggleWishlist={(e) => { e.preventDefault(); toggleSaved(product); }}
                        />
                      </div>
                    </>
                  )}

                  {adBreakpoints.includes(index + 1) && (
                    <div className={`col-span-2 ${viewMode === 'grid' ? 'lg:col-span-4' : 'w-full'} flex items-center justify-center my-2 md:my-4`}>
                      <AdUnit placementKey="PRODUCT_GRID_MPU" />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Load More Button */}
        {filteredProducts.length > 0 && hasMoreProducts && (
          <div className="mt-8 flex flex-col items-center gap-2">
            <button
              onClick={handleLoadMore}
              type="button"
              className="px-8 py-3 bg-gray-900 hover:bg-red-600 text-white font-semibold rounded-xl transition-all duration-200 active:scale-95"
            >
              Load More Products
            </button>
            <span className="text-sm text-gray-500">
              Showing {visibleProducts.length} of {filteredProducts.length} products
            </span>
          </div>
        )}

        {particles.length > 0 && (
          <DeferredFloatingParticles particles={particles} />
        )}
      </section>
    </div>
  );
};

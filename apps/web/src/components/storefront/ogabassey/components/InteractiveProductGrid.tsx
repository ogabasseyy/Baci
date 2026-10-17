'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';

import type { Product } from '../types';
import { AdvancedProductFilters } from './AdvancedProductFilters';
import { NativeProductRow } from './NativeProductRow';
import { FloatingParticles, type Particle } from './FloatingParticles';
import { ProductCard } from './ProductCard';

interface InteractiveProductGridProps {
  products: Product[];
  categories?: { name: string; slug: string }[];
  selectedCategory?: string;
  minPrice?: number;
  maxPrice?: number;
  title?: string;
  showViewAll?: boolean;
}

const PRODUCTS_PER_PAGE = 20;

export const InteractiveProductGrid: React.FC<InteractiveProductGridProps> = ({
  products,
  categories: explicitCategories,
  selectedCategory: defaultCategory = 'All',
  minPrice: defaultMin = 0,
  maxPrice: defaultMax = 100000000,
  title = 'Featured Products',
  showViewAll = true,
}) => {
  const { addToCart } = useCart();
  const merchantContext = useMerchantSafe();
  const basePath = merchantContext?.basePath || '';
  const getHref = (path: string) => path.startsWith('http') ? path : `${basePath}${path}`;
  const [addedItems, setAddedItems] = useState<number[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);

  const [selectedCategory, setSelectedCategory] = useState(defaultCategory);
  const [priceRange, setPriceRange] = useState({
    min: defaultMin,
    max: defaultMax,
  });
  const [selectedBrand, setSelectedBrand] = useState('All');
  const [selectedCondition, setSelectedCondition] = useState('All');
  const [minRating, setMinRating] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [displayCount, setDisplayCount] = useState(PRODUCTS_PER_PAGE);

  // Reset pagination during render (prev-value comparison) whenever a filter
  // changes, instead of through a useEffect — React restarts the render
  // before commit, so shoppers never see a stale page-size frame.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const filtersKey = JSON.stringify([
    selectedCategory,
    priceRange.min,
    priceRange.max,
    selectedBrand,
    selectedCondition,
    minRating,
  ]);
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (filtersKey !== prevFiltersKey) {
    setPrevFiltersKey(filtersKey);
    setDisplayCount(PRODUCTS_PER_PAGE);
  }

  const categories = (() => {
    if (explicitCategories && explicitCategories.length > 0) {
      const result = ['All'];
      for (const c of explicitCategories) {
        if (c.name) result.push(c.name);
      }
      return result;
    }

    const categorySet = new Set<string>();
    for (const p of products) {
      const cat = p.categories?.name || p.category;
      if (cat) categorySet.add(cat);
    }
    return ['All', ...Array.from(categorySet)];
  })();

  const brands = (() => {
    const brandSet = new Set<string>();
    for (const p of products) {
      if (p.brand) brandSet.add(p.brand);
    }
    return Array.from(brandSet);
  })();

  const filteredProducts = products.filter((product) => {
    const productCategory = product.categories?.name || product.category;
    if (selectedCategory !== 'All' && productCategory !== selectedCategory) {
      return false;
    }
    if (selectedBrand !== 'All' && product.brand !== selectedBrand) {
      return false;
    }
    if (
      selectedCondition !== 'All' &&
      product.condition !== selectedCondition
    ) {
      return false;
    }
    const rating = product.rating ?? 0;
    if (rating < minRating) {
      return false;
    }
    const productPrice = product.rawPrice || 0;
    if (
      productPrice < priceRange.min ||
      (priceRange.max > 0 && productPrice > priceRange.max)
    ) {
      return false;
    }
    return true;
  });

  const handleAddToCart = (e: React.MouseEvent, product: Product) => {
    if (addToCart(product as any, 1) === 'rejected') {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const id = Date.now() + Math.random();
    setParticles((prev) => [
      ...prev,
      {
        id,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
    ]);

    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => p.id !== id));
    }, 1000);

    const pid =
      typeof product.id === 'string'
        ? Number.parseInt(product.id, 10)
        : product.id;
    setAddedItems((prev) => [...prev, pid]);
    setTimeout(() => {
      setAddedItems((prev) => prev.filter((id) => id !== pid));
    }, 2000);
  };

  const handleResetFilters = () => {
    setSelectedCategory('All');
    setPriceRange({ min: 0, max: 100000000 });
    setSelectedBrand('All');
    setSelectedCondition('All');
    setMinRating(0);
    setDisplayCount(PRODUCTS_PER_PAGE); // Reset pagination on filter reset
  };

  const visibleProducts = filteredProducts.slice(0, displayCount);
  const hasMoreProducts = displayCount < filteredProducts.length;

  const handleLoadMore = () => {
    setDisplayCount((prev) => prev + PRODUCTS_PER_PAGE);
  };

  return (
    <>
      <AdvancedProductFilters
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        minPrice={priceRange.min}
        maxPrice={priceRange.max}
        onPriceChange={(min, max) => setPriceRange({ min, max })}
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

      <section className="max-w-[1400px] mx-auto px-3 md:px-6 pt-6 md:pt-8 pb-20 relative">
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

          <div className="flex items-center gap-4">
            {showViewAll && (
              <Link
                href={asRoute(getHref('/products'))}
                className="hidden text-xs font-medium text-white/70 transition-colors hover:text-white md:text-base sm:block"
              >
                View all products
              </Link>
            )}
          </div>
        </div>

        {filteredProducts.length === 0 ? (
          <div className="text-center py-20 bg-gray-50 rounded-2xl border border-gray-100">
            <p className="text-gray-500 text-lg">
              No products found matching your filters.
            </p>
            <button type="button"
              onClick={handleResetFilters}
              className="mt-4 text-primary font-semibold hover:underline"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div
            className={
              viewMode === 'grid'
                ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6'
                : 'flex flex-col gap-3 md:gap-4'
            }
          >
            {visibleProducts.map((product, index) => {
              const pid =
                typeof product.id === 'string'
                  ? Number.parseInt(product.id, 10)
                  : product.id;
              const isAdded = addedItems.includes(pid);

              return (
                <React.Fragment key={product.id}>
                  {/* Unified ProductCard handles both grid and list views */}
                  <ProductCard
                    product={product}
                    onAddToCart={handleAddToCart}
                    isAdded={isAdded}
                    viewMode={viewMode}
                  />

                  {/* AUTOMATED AD INSERTION: Native Product Row after 2 rows (8 items) */}
                  {(index + 1 === 8) && (
                    <div className="col-span-2 md:col-span-3 lg:col-span-4 w-full my-6">
                      <div className="w-full">
                        <NativeProductRow
                          storeSlug={merchantContext?.merchant?.slug}
                          slotPrefix={`grid-native-${index}`}
                        />
                      </div>
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
            <button type="button"
              onClick={handleLoadMore}
              className="px-8 py-3 bg-gray-900 hover:bg-primary text-white font-semibold rounded-xl transition-all duration-200 active:scale-95"
            >
              Load More Products
            </button>
            <span className="text-sm text-gray-500">
              Showing {visibleProducts.length} of {filteredProducts.length} products
            </span>
          </div>
        )}

        {/* Floating Particles for +1 animation */}
        <FloatingParticles particles={particles} />
      </section>
    </>
  );
};

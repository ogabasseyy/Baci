import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import type { Product } from '@/lib/products';

// Lazy load heavy components to reduce initial bundle size
const ReviewsSection = dynamic(
  () =>
    import('@/components/storefront/reviews-section').then(
      (mod) => mod.ReviewsSection
    ),
  {
    loading: () => <Skeleton className="h-[400px] w-full rounded-xl" />,
  }
);

// Koray-aligned semantic product sections
const BrandProducts = dynamic(
  () =>
    import('@/components/storefront/brand-products').then(
      (mod) => mod.BrandProducts
    ),
  {
    loading: () => <Skeleton className="h-[300px] w-full rounded-xl" />,
  }
);

const PriceRangeProducts = dynamic(
  () =>
    import('@/components/storefront/price-range-products').then(
      (mod) => mod.PriceRangeProducts
    ),
  {
    loading: () => <Skeleton className="h-[300px] w-full rounded-xl" />,
  }
);

const RecentlyViewedProducts = dynamic(
  () =>
    import('@/components/storefront/recently-viewed').then(
      (mod) => mod.RecentlyViewedProducts
    ),
  {
    loading: () => <Skeleton className="h-[300px] w-full rounded-xl" />,
  }
);

/**
 * PDP below-fold sections: reviews, same-brand, same-category, and
 * recently viewed. Split from ProductDetailClient (modularity rule).
 */
export function ProductDetailBelowFold({ product }: { product: Product }) {
  return (
    <>
      {/* Customer Reviews */}
      <ReviewsSection
        productId={product.id}
        productName={product.name}
        className="mt-8 border-t pt-8 max-w-4xl mx-auto"
      />

      {/* Koray-aligned semantic sections: Same brand, same category */}
      <BrandProducts
        product={product}
        maxProducts={4}
        className="mt-8 border-t"
      />

      {/* Koray-aligned semantic sections: Same category, similar price */}
      <PriceRangeProducts
        product={product}
        maxProducts={4}
        className="border-t"
      />

      {/* Recently Viewed Products - User convenience only, no SEO value */}
      <div data-nosnippet>
        <RecentlyViewedProducts
          excludeProductId={product.id}
          maxProducts={6}
          className="border-t"
        />
      </div>
    </>
  );
}

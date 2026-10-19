'use client';

import { ChevronLeft, ChevronRight, Clock, Loader2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ThemedButton, ThemedCard } from '@/components/themed';
import { CardContent } from '@/components/ui/card';
import { useCart } from '@/hooks/use-cart';
import { useCurrency } from '@/hooks/use-currency';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import {
  getRecentlyViewedIds,
  useRecentlyViewed,
} from '@/hooks/use-recently-viewed';
import { useToast } from '@/hooks/use-toast';
import { apiGet } from '@/lib/api-client';
import { getEffectiveStock } from '@/lib/product-stock';
import type { Product } from '@/lib/products';
import { getProductUrl } from '@/lib/seo-utils';
import { cn } from '@/lib/utils';

interface RecentlyViewedProductsProps {
  /** Current product ID to exclude from the list */
  excludeProductId?: string;
  /** Maximum number of products to show (default: 6) */
  maxProducts?: number;
  /** Section title (default: "Recently Viewed") */
  title?: string;
  /** Show navigation arrows (default: true) */
  showNavigation?: boolean;
  /** Custom class name for the container */
  className?: string;
}

/** localStorage never notifies in-tab; we only need the snapshot reads. */
function subscribeToNothing(): () => void {
  return () => {
    // Intentionally empty: nothing to unsubscribe from.
  };
}

export function RecentlyViewedProducts({
  excludeProductId,
  maxProducts = 6,
  title = 'Recently Viewed',
  showNavigation = true,
  className,
}: RecentlyViewedProductsProps) {
  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant ?? null;
  const { recentlyViewedIds } = useRecentlyViewed({
    excludeProductId,
    maxItems: maxProducts + 1, // +1 to account for possible exclusion
  });

  const { formatCurrency } = useCurrency();
  const { addToCart } = useCart();
  const { toast } = useToast();

  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scrollPosition, setScrollPosition] = useState(0);

  const merchantId = merchant?.id ?? null;

  // Whether localStorage already holds any fetchable id. Read via an
  // external-store subscription so the SSR spinner resolves to "empty"
  // after hydration without a setState inside an effect. The server
  // snapshot mirrors the original first paint (spinner shown).
  const hasStoredIds = useSyncExternalStore(
    subscribeToNothing,
    () =>
      getRecentlyViewedIds(merchantId).some((id) => id !== excludeProductId),
    () => true
  );

  // Adjust loading/products state during render when the fetch inputs
  // change (render-phase prev-compare instead of a setState-in-effect).
  const canFetch = Boolean(merchantId) && recentlyViewedIds.length > 0;
  const fetchKey = `${merchantId ?? ''}|${maxProducts}|${recentlyViewedIds.join(',')}`;
  const [prevFetchKey, setPrevFetchKey] = useState(fetchKey);
  if (prevFetchKey !== fetchKey) {
    setPrevFetchKey(fetchKey);
    setIsLoading(canFetch);
    if (!canFetch) {
      setProducts([]);
    }
  }

  // Fetch products by IDs
  useEffect(() => {
    if (!merchant?.id || recentlyViewedIds.length === 0) {
      return;
    }

    // Fetch products by IDs
    const idsParam = recentlyViewedIds.slice(0, maxProducts).join(',');
    const params = new URLSearchParams({
      merchant_id: merchant.id,
      ids: idsParam,
      compact: 'true',
    });
    apiGet<{ products: Product[] }>(`/api/storefront/products?${params}`)
      .then((data) => {
        if (data.products) {
          // Sort products to match the order in recentlyViewedIds
          const productMap = new Map(data.products.map((p) => [p.id, p]));
          const orderedProducts = recentlyViewedIds
            .map((id) => productMap.get(id))
            .filter((p): p is Product => !!p && p.status === 'active')
            .slice(0, maxProducts);
          setProducts(orderedProducts);
        }
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch recently viewed products:', err);
        setProducts([]);
        setIsLoading(false);
      });
  }, [merchant?.id, recentlyViewedIds, maxProducts]);

  const handleAddToCart = (product: Product) => {
    const outcome = addToCart(product);
    if (outcome === 'rejected') {
      toast({
        title: 'Unable to add to cart',
        description: 'There is no available stock left for this selection.',
        variant: 'destructive',
      });
      return;
    }
    toast({
      title: 'Added to cart',
      description: `${product.name} has been added to your cart.`,
    });
  };

  const scrollContainer = (direction: 'left' | 'right') => {
    const container = document.getElementById('recently-viewed-scroll');
    if (!container) return;

    const scrollAmount = 300; // px to scroll
    const newPosition =
      direction === 'left'
        ? Math.max(0, scrollPosition - scrollAmount)
        : scrollPosition + scrollAmount;

    container.scrollTo({ left: newPosition, behavior: 'smooth' });
    setScrollPosition(newPosition);
  };

  // Only show the loading state while there is something to resolve.
  const showLoading = isLoading && hasStoredIds;

  // Don't render if no recently viewed products
  if (!showLoading && products.length === 0) {
    return null;
  }

  const isOutOfStock = (product: Product) =>
    product.manage_stock !== false && getEffectiveStock(product) <= 0;

  return (
    <section className={cn('w-full py-8 md:py-12', className)}>
      <div className="container px-4 md:px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Clock
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
              {title}
            </h2>
          </div>

          {showNavigation && products.length > 3 && (
            <div className="hidden sm:flex items-center gap-2">
              <ThemedButton
                variant="outline"
                size="icon"
                colorRole="accent"
                className="size-8"
                onClick={() => scrollContainer('left')}
                aria-label="Scroll left"
              >
                <ChevronLeft className="size-4" />
              </ThemedButton>
              <ThemedButton
                variant="outline"
                size="icon"
                colorRole="accent"
                className="size-8"
                onClick={() => scrollContainer('right')}
                aria-label="Scroll right"
              >
                <ChevronRight className="size-4" />
              </ThemedButton>
            </div>
          )}
        </div>

        {/* Products */}
        {showLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div
            id="recently-viewed-scroll"
            className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            onScroll={(e) => setScrollPosition(e.currentTarget.scrollLeft)}
          >
            {products.map((product) => (
              <ThemedCard
                key={product.id}
                className="shrink-0 w-[200px] sm:w-[240px] overflow-hidden hover:shadow-lg transition-shadow snap-start"
                accentPosition="top"
              >
                <Link href={getProductUrl(product)} className="block relative">
                  <Image
                    src={product.imageLarge || product.image}
                    alt={product.name}
                    data-ai-hint={product.imageHint}
                    width={240}
                    height={240}
                    className="object-cover w-full aspect-square"
                  />
                  {product.compare_at_price &&
                    product.compare_at_price > product.price && (
                      <span className="absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-md shadow-sm">
                        SALE
                      </span>
                    )}
                </Link>
                <CardContent className="p-3">
                  <Link href={getProductUrl(product)}>
                    <h3 className="font-medium text-sm line-clamp-2 hover:text-store-primary transition-colors">
                      {product.name}
                    </h3>
                  </Link>
                  <div className="flex items-center justify-between mt-2">
                    <div>
                      <p
                        className="font-bold text-sm"
                        style={{ color: 'var(--store-primary)' }}
                      >
                        {formatCurrency(product.price)}
                      </p>
                      {product.compare_at_price &&
                        product.compare_at_price > product.price && (
                          <p className="text-xs text-muted-foreground line-through">
                            {formatCurrency(product.compare_at_price)}
                          </p>
                        )}
                    </div>
                    <ThemedButton
                      colorRole="primary"
                      size="sm"
                      className="text-xs px-2 py-1 h-7"
                      onClick={() => handleAddToCart(product)}
                      disabled={isOutOfStock(product)}
                    >
                      Add
                    </ThemedButton>
                  </div>
                </CardContent>
              </ThemedCard>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

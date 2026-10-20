'use client';

import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ThemedButton, ThemedCard } from '@/components/themed';
import { CardContent } from '@/components/ui/card';
import { useCart } from '@/hooks/cart';
import { useCurrency } from '@/hooks/use-currency';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import { apiGet } from '@/lib/api-client';
import { getEffectiveStock } from '@/lib/product-stock';
import type { Product } from '@/lib/products';
import { generateSlug, getProductUrl } from '@/lib/seo-utils';
import { cn } from '@/lib/utils';
import { useViewportActivation } from './use-viewport-activation';

interface BrandProductsProps {
  /** Current product to find same-brand products for */
  product: Product;
  /** Maximum number of products to show (default: 4) */
  maxProducts?: number;
  /** Custom class name for the container */
  className?: string;
}

/**
 * Brand Products Component (Koray-aligned)
 *
 * Shows products from the SAME brand AND SAME category as the current product.
 * This follows Koray's semantic internal linking principle:
 * - Same category maintains topical focus
 * - Same brand builds brand entity authority
 * - Clear anchor text: "More [Brand] [Category]"
 */
export function BrandProducts({
  product,
  maxProducts = 4,
  className,
}: BrandProductsProps) {
  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant ?? null;
  const basePath = merchantContext?.basePath || '';
  const { formatCurrency } = useCurrency();
  const { addToCart } = useCart();
  const { toast } = useToast();

  // Helper to prepend merchant basePath to product URL
  const getFullProductUrl = (p: Product): string => {
    const productUrl = getProductUrl(p);
    return basePath ? `${basePath}${productUrl}` : productUrl;
  };

  const [brandProducts, setBrandProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scrollPosition, setScrollPosition] = useState(0);

  // Derive brand and category from current product
  const productBrand = product.brand;
  const categoriesName = product.categories?.name;
  const categoryFallback = product.category;
  const productCategory = categoriesName || categoryFallback || '';
  const categoriesSlug = product.categories?.slug;
  const categorySlugFallback = product.category_slug;
  const categorySlug =
    categoriesSlug || categorySlugFallback || generateSlug(productCategory);
  const fetchLimit = Math.max(maxProducts + 2, 8);
  const { ref: sectionRef, isActive } = useViewportActivation<HTMLElement>({
    enabled: Boolean(merchant?.id && productBrand && productCategory),
  });

  // Adjust loading/list state during render (prev-key comparison) instead of
  // inside the effect, so the effect only performs the async fetch.
  const canFetch = Boolean(
    merchant?.id && productBrand && productCategory && isActive
  );
  const fetchKey = canFetch
    ? JSON.stringify([
        merchant?.id,
        product.id,
        productBrand,
        categorySlug,
        productCategory,
        fetchLimit,
        maxProducts,
      ])
    : `idle:${isActive}`;
  const [prevFetchKey, setPrevFetchKey] = useState<string | null>(null);
  if (fetchKey !== prevFetchKey) {
    setPrevFetchKey(fetchKey);
    if (canFetch) {
      setIsLoading(true);
    } else {
      setBrandProducts((prev) => (prev.length === 0 ? prev : []));
      setIsLoading(!isActive);
    }
  }

  useEffect(() => {
    if (!merchant?.id || !productBrand || !productCategory || !isActive) {
      return;
    }

    const params = new URLSearchParams({
      merchant_id: merchant.id,
      category: categorySlug,
      brand: productBrand,
      limit: String(fetchLimit),
      compact: 'true',
      has_images: 'true',
    });

    apiGet<{ products: Product[] }>(`/api/storefront/products?${params}`)
      .then((data) => {
        if (data.products) {
          const sameBrand = data.products.filter(
            (p) =>
              p.id !== product.id &&
              p.status === 'active' &&
              typeof p.brand === 'string' &&
              p.brand.toLowerCase() === productBrand.toLowerCase()
          );
          setBrandProducts(sameBrand.slice(0, maxProducts));
        }
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch brand products:', err);
        setBrandProducts([]);
        setIsLoading(false);
      });
  }, [
    isActive,
    merchant?.id,
    product.id,
    productBrand,
    categorySlug,
    productCategory,
    fetchLimit,
    maxProducts,
  ]);

  const handleAddToCart = (p: Product) => {
    const outcome = addToCart(p);
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
      description: `${p.name} has been added to your cart.`,
    });
  };

  const scrollContainer = (direction: 'left' | 'right') => {
    const container = document.getElementById('brand-products-scroll');
    if (!container) return;

    const scrollAmount = 300;
    const newPosition =
      direction === 'left'
        ? Math.max(0, scrollPosition - scrollAmount)
        : scrollPosition + scrollAmount;

    container.scrollTo({ left: newPosition, behavior: 'smooth' });
    setScrollPosition(newPosition);
  };

  if (!isActive && !productBrand) {
    return null;
  }

  if (!productBrand) {
    return null;
  }

  if (isActive && !isLoading && brandProducts.length === 0) {
    return null;
  }

  const isOutOfStock = (p: Product) =>
    p.manage_stock !== false && getEffectiveStock(p) <= 0;

  const title = `More ${productBrand} ${productCategory}`;
  const categoryHref = categorySlug ? `${basePath}/${categorySlug}` : null;

  return (
    <section ref={sectionRef} className={cn('w-full py-8 md:py-12', className)}>
      <div className="container px-4 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
              {title}
            </h2>
            {categoryHref ? (
              <Link
                href={categoryHref as '/'}
                prefetch={false}
                className="mt-2 inline-flex text-sm font-semibold transition-colors hover:text-store-primary"
              >
                Shop more {productCategory}
              </Link>
            ) : null}
          </div>

          {brandProducts.length > 3 && (
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

        {!isActive ? (
          <div
            aria-hidden="true"
            className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide"
          >
            {Array.from(
              { length: maxProducts },
              (_, index) => `brand-placeholder-${index}`
            ).map((placeholderKey) => (
              <div
                key={placeholderKey}
                className="h-[320px] w-[200px] shrink-0 rounded-xl bg-muted/40 sm:w-[260px]"
              />
            ))}
          </div>
        ) : isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div
            id="brand-products-scroll"
            className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            onScroll={(e) => setScrollPosition(e.currentTarget.scrollLeft)}
          >
            {brandProducts
              .filter((p) => p.imageLarge || p.image)
              .map((p) => (
                <ThemedCard
                  key={p.id}
                  className="shrink-0 w-[200px] sm:w-[260px] overflow-hidden hover:shadow-lg transition-shadow snap-start"
                  accentPosition="top"
                >
                  <Link
                    href={getFullProductUrl(p) as '/'}
                    prefetch={false}
                    className="block relative"
                  >
                    <Image
                      src={p.imageLarge || p.image || '/placeholder.svg'}
                      alt={p.name}
                      data-ai-hint={p.imageHint}
                      width={260}
                      height={260}
                      className="object-cover w-full aspect-square"
                    />
                    {p.compare_at_price && p.compare_at_price > p.price && (
                      <span className="absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-md shadow-sm">
                        SALE
                      </span>
                    )}
                  </Link>
                  <CardContent className="p-3">
                    <Link href={getFullProductUrl(p) as '/'} prefetch={false}>
                      <h3 className="font-medium text-sm line-clamp-2 hover:text-store-primary transition-colors">
                        {p.name}
                      </h3>
                    </Link>
                    <div className="flex items-center justify-between mt-2">
                      <div>
                        <p
                          className="font-bold text-sm"
                          style={{ color: 'var(--store-primary)' }}
                        >
                          {formatCurrency(p.price)}
                        </p>
                        {p.compare_at_price && p.compare_at_price > p.price && (
                          <p className="text-xs text-muted-foreground line-through">
                            {formatCurrency(p.compare_at_price)}
                          </p>
                        )}
                      </div>
                      <ThemedButton
                        colorRole="primary"
                        size="sm"
                        className="text-xs px-2 py-1 h-7"
                        onClick={() => handleAddToCart(p)}
                        disabled={isOutOfStock(p)}
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

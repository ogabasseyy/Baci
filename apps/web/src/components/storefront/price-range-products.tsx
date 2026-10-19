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
import { getProductUrl } from '@/lib/seo-utils';
import { getCuratedPriceBands } from '@/lib/storefront-compare/price-band-taxonomy';
import { cn } from '@/lib/utils';
import { useViewportActivation } from './use-viewport-activation';

interface PriceRangeProductsProps {
  product: Product;
  maxProducts?: number;
  priceTolerance?: number;
  className?: string;
}

export function PriceRangeProducts({
  product,
  maxProducts = 4,
  priceTolerance = 0.15,
  className,
}: PriceRangeProductsProps) {
  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant ?? null;
  const basePath = merchantContext?.basePath || '';
  const { formatCurrency } = useCurrency();
  const getFullProductUrl = (p: Product): string => {
    const productUrl = getProductUrl(p);
    return basePath ? `${basePath}${productUrl}` : productUrl;
  };
  const { addToCart } = useCart();
  const { toast } = useToast();

  // Fetched products tagged with the fetch inputs that produced them, so the
  // loading flag and visible list derive during render instead of being
  // mirrored into extra state from inside the effect.
  const [fetchResult, setFetchResult] = useState<{
    key: string;
    products: Product[];
  } | null>(null);
  const [scrollPosition, setScrollPosition] = useState(0);
  const categoriesName = product.categories?.name;
  const categoryFallback = product.category;
  const productCategory = categoriesName || categoryFallback || '';
  const categoriesSlug = product.categories?.slug;
  const categorySlugFallback = product.category_slug;
  const categorySlug =
    categoriesSlug || categorySlugFallback || productCategory.toLowerCase();
  const rawPrice = Number(product.price);
  const isValidPrice = Number.isFinite(rawPrice) && rawPrice > 0;
  const minPrice = isValidPrice
    ? Math.floor(rawPrice * (1 - priceTolerance))
    : 0;
  const maxPrice = isValidPrice
    ? Math.floor(rawPrice * (1 + priceTolerance))
    : 0;
  const fetchLimit = Math.max(maxProducts * 3, 12);
  const { ref: sectionRef, isActive } = useViewportActivation<HTMLElement>({
    enabled: Boolean(merchant?.id && productCategory && isValidPrice),
  });

  const merchantId = merchant?.id;
  const canFetch = Boolean(
    merchantId && productCategory && isValidPrice && isActive
  );
  const fetchKey = canFetch
    ? [
        merchantId,
        categorySlug,
        minPrice,
        maxPrice,
        fetchLimit,
        product.id,
        product.price,
        maxProducts,
      ].join('|')
    : null;

  useEffect(() => {
    if (!fetchKey || !merchantId) {
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({
      merchant_id: merchantId,
      category: categorySlug,
      min_price: minPrice.toString(),
      max_price: maxPrice.toString(),
      limit: fetchLimit.toString(),
      compact: 'true',
      has_images: 'true',
    });

    apiGet<{ products: Product[] }>(`/api/storefront/products?${params}`)
      .then((data) => {
        if (cancelled) {
          return;
        }
        const matches = (data.products ?? []).filter(
          (p) => p.id !== product.id && p.status === 'active'
        );
        matches.sort(
          (a, b) =>
            Math.abs(a.price - product.price) -
            Math.abs(b.price - product.price)
        );
        setFetchResult({
          key: fetchKey,
          products: matches.slice(0, maxProducts),
        });
      })
      .catch((err) => {
        console.error('Failed to fetch price range products:', err);
        if (!cancelled) {
          setFetchResult({ key: fetchKey, products: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    fetchKey,
    merchantId,
    product.id,
    product.price,
    categorySlug,
    fetchLimit,
    minPrice,
    maxPrice,
    maxProducts,
  ]);

  // Derived during render: a result only counts when it matches the current
  // fetch inputs, and the section is "loading" until that result lands.
  const priceRangeProducts =
    fetchKey !== null && fetchResult?.key === fetchKey
      ? fetchResult.products
      : [];
  const isLoading = canFetch ? fetchResult?.key !== fetchKey : !isActive;

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
    const container = document.getElementById('price-range-products-scroll');
    if (!container) return;

    const scrollAmount = 300;
    const newPosition =
      direction === 'left'
        ? Math.max(0, scrollPosition - scrollAmount)
        : scrollPosition + scrollAmount;

    container.scrollTo({ left: newPosition, behavior: 'smooth' });
    setScrollPosition(newPosition);
  };

  if (!isValidPrice || !productCategory) {
    return null;
  }

  if (isActive && !isLoading && priceRangeProducts.length === 0) {
    return null;
  }

  const isOutOfStock = (p: Product) =>
    p.manage_stock !== false && getEffectiveStock(p) <= 0;

  const formatPriceRange = () => {
    const formattedMax = formatCurrency(maxPrice);
    const formattedMin = formatCurrency(minPrice);

    if (minPrice < 10000) {
      return `${productCategory} Under ${formattedMax}`;
    }

    return `${productCategory} ${formattedMin} - ${formattedMax}`;
  };

  // Use the curated band label as descriptive heading copy when the product
  // falls inside a defined band, but do NOT link it here: this client rail only
  // sees a ±priceTolerance window, not the band's full inventory, so it cannot
  // verify the band page is indexable (active product / spec thresholds). The
  // server-gated, indexable band link is surfaced via CommercialSupportLinks
  // ("Compare and Buying Guides") instead — linking here risks pointing at a
  // thin band page that 404s.
  const curatedPriceBand =
    getCuratedPriceBands(categorySlug).find(
      (band) =>
        rawPrice <= band.ceiling &&
        (band.floor === undefined || rawPrice >= band.floor)
    ) ?? null;
  const title = curatedPriceBand?.label ?? formatPriceRange();

  return (
    <section ref={sectionRef} className={cn('w-full py-8 md:py-12', className)}>
      <div className="container px-4 md:px-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            {title}
          </h2>

          {priceRangeProducts.length > 3 && (
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
              (_, index) => `price-range-placeholder-${index}`
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
            id="price-range-products-scroll"
            className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            onScroll={(e) => setScrollPosition(e.currentTarget.scrollLeft)}
          >
            {priceRangeProducts
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
                    {p.brand && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {p.brand}
                      </p>
                    )}
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

'use client';

import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { Check, Info, Minus, Plus } from 'lucide-react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Breadcrumbs } from '@/components/storefront/breadcrumbs';
import { DeferredStickyAddToCart } from '@/components/storefront/deferred-sticky-add-to-cart';
import { ThemedBadge, ThemedButton } from '@/components/themed';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useCart } from '@/hooks/cart';
import { useCurrency } from '@/hooks/use-currency';
import { useMerchant } from '@/hooks/use-merchant-client';
import { useRecentlyViewed } from '@/hooks/use-recently-viewed';
import { useToast } from '@/hooks/use-toast';
import { trackEvent } from '@/lib/event-tracking';
import { getEffectiveStock } from '@/lib/product-stock';
import type { Product, ProductVariant } from '@/lib/products';
import { asRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';
import type { FAQItem } from '@/types/faq';
import type { ProductCondition } from './product-selection-condition';
import { PLACEHOLDER_IMAGE } from './product-selection-placeholder';
import { useProductOfferSelection } from './use-product-offer-selection';

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
 * Check if a variant with given attributes exists and has stock
 */
function isVariantAvailable(
  variants: ProductVariant[],
  partialAttributes: Record<string, string>,
  isStockManaged: boolean,
  fallbackStock: number,
  options?: {
    condition?: ProductCondition | null;
    usesVariantConditions?: boolean;
  }
): boolean {
  if (!isStockManaged) {
    return variants.some((variant) => {
      const conditionMatches =
        !options?.usesVariantConditions ||
        !options.condition ||
        variant.condition === options.condition;

      return (
        conditionMatches &&
        Object.entries(partialAttributes).every(
          ([key, value]) => variant.attributes[key] === value
        )
      );
    });
  }

  return variants.some((variant) => {
    const conditionMatches =
      !options?.usesVariantConditions ||
      !options.condition ||
      variant.condition === options.condition;
    const matches = Object.entries(partialAttributes).every(
      ([key, value]) => variant.attributes[key] === value
    );
    return (
      conditionMatches &&
      matches &&
      getEffectiveStock({
        stock: variant.stock_quantity ?? fallbackStock,
        stock_quantity: variant.stock_quantity ?? fallbackStock,
      }) > 0
    );
  });
}

export default function ProductDetailClient({
  product,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: Reserved for future FAQ section implementation
  faqs,
}: {
  product: Product;
  faqs?: FAQItem[];
}) {
  const { merchant, basePath } = useMerchant();
  const getHref = (path: string) =>
    path.startsWith('http') ? path : `${basePath || ''}${path}`;
  const { cart, addToCart, updateQuantity, setMerchantSlug } = useCart();
  const { toast } = useToast();
  const { formatCurrency, currencyCode } = useCurrency();
  const { addToRecentlyViewed } = useRecentlyViewed();
  const [quantity, setQuantity] = useState(product.minimum_order_quantity || 1);
  const {
    attributeOptions,
    availableConditionOptions,
    conditionDescriptions,
    conditionLabels,
    currentCompareAtPrice,
    currentPrice,
    currentStock,
    currentVariantSelection,
    effectiveVariant,
    effectiveVariantAttributes,
    effectiveVariantId,
    handleAttributeChange,
    handleConditionChange,
    isOutOfStock,
    isStockManaged,
    selectedCondition,
    selectedImage,
    selectedOffer,
    setSelectedImage,
    usesVariantConditions,
  } = useProductOfferSelection(product);

  // Track product view for recently viewed and analytics
  // Use product.id instead of product object to prevent duplicate tracking on reference changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: Intentionally using product.id to prevent duplicate analytics calls on object reference changes
  useEffect(() => {
    if (product?.id) {
      addToRecentlyViewed(product.id);
      // Track product view for merchant analytics
      if (merchant?.id) {
        trackEvent.productView(merchant.id, product, currencyCode);
      }
    }
  }, [product?.id, merchant?.id, currencyCode, addToRecentlyViewed]);

  // Product is guaranteed to exist by server component, but guard against archived status
  // Note: Can't call notFound() after hooks in client components, so we render null
  // The server component already handles the notFound() case for missing products
  if (!product || product.status === 'archived') {
    return null;
  }

  const handleAddToCart = () => {
    const variantForCart = currentVariantSelection?.variant;
    const productToAdd =
      variantForCart || selectedOffer
        ? { ...product, price: currentPrice }
        : product;

    // Store merchant slug for checkout
    if (merchant?.slug) {
      setMerchantSlug(merchant.slug);
    }

    if (product.has_variants && !variantForCart) {
      toast({
        title: 'Select a variant',
        description: 'Please select a valid variant before adding this item.',
        variant: 'destructive',
      });
      return;
    }

    addToCart(
      productToAdd,
      quantity,
      variantForCart
        ? {
            condition: selectedCondition,
            variantId: variantForCart.id,
            variantAttributes: effectiveVariantAttributes,
          }
        : selectedOffer
          ? { condition: selectedCondition }
          : undefined
    );

    // Track add to cart for merchant analytics
    if (merchant?.id) {
      trackEvent.addToCart(merchant.id, productToAdd, quantity, currencyCode);
    }

    const variantInfo = variantForCart
      ? ` (${Object.values(effectiveVariantAttributes).join(', ')})`
      : '';

    toast({
      title: 'Added to cart!',
      description: `${quantity} x ${product.name}${variantInfo} has been added to your cart.`,
    });
  };

  const handleQuantityChange = (newQuantity: number) => {
    const moq = product.minimum_order_quantity || 1;
    if (newQuantity >= moq) {
      setQuantity(newQuantity);
    } else {
      setQuantity(moq);
    }
  };

  const effectiveSelectedCondition =
    normalizeCanonicalProductCondition(
      selectedCondition ?? product.condition
    ) || 'new';

  // Find cart item matching product and variant
  const cartItem = cart.find((item) => {
    if (effectiveVariantId) {
      return item.id === product.id && item.variantId === effectiveVariantId;
    }

    // Base/simple products store no condition in cart. Only offer-driven
    // selections need an explicit condition match on non-variant rows.
    return (
      item.id === product.id &&
      !item.variantId &&
      (normalizeCanonicalProductCondition(
        item.condition ?? product.condition
      ) || 'new') === effectiveSelectedCondition
    );
  });

  // Main render
  return (
    <>
      <div className="flex flex-col min-h-screen">
        {/* Main Content - Layout provided by Global OgabasseyLayout */}
        <main
          id="main-content"
          className="flex-1 container mx-auto py-8 px-4 md:px-6"
        >
          {/* Visual Breadcrumbs */}
          <Breadcrumbs
            items={[
              ...(product.categories?.name || product.category
                ? [
                    {
                      label: product.categories?.name || product.category || '',
                      href: `/?category=${encodeURIComponent(product.categories?.name || product.category || '')}`,
                    },
                  ]
                : []),
              { label: product.name },
            ]}
            separator="chevron"
            className="max-w-4xl mx-auto mb-4"
          />

          <div className="grid md:grid-cols-2 gap-8 lg:gap-12 max-w-4xl mx-auto">
            {/* Image Gallery */}
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg overflow-hidden aspect-square relative border border-border/50">
                <Image
                  src={selectedImage || PLACEHOLDER_IMAGE}
                  alt={product.name}
                  data-ai-hint={product.imageHint}
                  fill
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  priority
                  className="object-cover"
                />
              </div>
              {product.images && product.images.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedImage(product.imageLarge || product.image)
                    }
                    className={cn(
                      'relative w-20 h-20 rounded-md overflow-hidden border-2 shrink-0',
                      selectedImage === (product.imageLarge || product.image)
                        ? 'border-primary'
                        : 'border-transparent'
                    )}
                  >
                    <Image
                      src={
                        product.imageLarge || product.image || PLACEHOLDER_IMAGE
                      }
                      alt={`${product.name} - Main image`}
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  </button>
                  {product.images
                    .filter((img) => img.url)
                    .map((img, idx) => (
                      <button
                        key={img.url || `img-${idx}`}
                        type="button"
                        onClick={() => setSelectedImage(img.url)}
                        className={cn(
                          'relative w-20 h-20 rounded-md overflow-hidden border-2 shrink-0',
                          selectedImage === img.url
                            ? 'border-primary'
                            : 'border-transparent'
                        )}
                      >
                        <Image
                          src={img.url}
                          alt={img.alt || `Product image ${idx + 1}`}
                          fill
                          sizes="80px"
                          className="object-cover"
                        />
                      </button>
                    ))}
                </div>
              )}
            </div>

            <div className="flex flex-col justify-center gap-y-6 py-4">
              <div>
                <h1
                  className="text-3xl lg:text-4xl font-bold font-headline"
                  style={{ color: 'var(--store-primary)' }}
                >
                  {product.name}
                </h1>

                {/* SKU / MPN Display */}
                {(product.sku || product.mpn) && (
                  <p className="text-sm text-muted-foreground mt-1">
                    SKU: {product.sku || product.mpn}
                  </p>
                )}

                {product.fulfillmentFields &&
                  product.fulfillmentFields.length > 0 && (
                    <div className="text-sm text-gray-500 mt-2">
                      <p className="font-medium">Requires:</p>
                      <ul className="list-disc list-inside">
                        {product.fulfillmentFields.map((field) => (
                          <li key={field.name}>{field.name}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                <div className="flex items-baseline gap-3 mt-2">
                  <p
                    className="text-3xl font-bold"
                    style={{ color: 'var(--store-secondary)' }}
                  >
                    {formatCurrency(currentPrice)}
                  </p>
                  {currentCompareAtPrice &&
                    currentCompareAtPrice > currentPrice && (
                      <p className="text-lg text-muted-foreground line-through decoration-red-500/50">
                        {formatCurrency(currentCompareAtPrice)}
                      </p>
                    )}
                </div>
              </div>

              <div className="prose prose-sm text-muted-foreground text-lg leading-relaxed">
                <p>{product.description}</p>
              </div>

              {/* Condition Selector */}
              {usesVariantConditions && availableConditionOptions.length > 0 ? (
                <div className="space-y-3">
                  <Label className="text-sm font-medium block">
                    Condition:{' '}
                    <span style={{ color: 'var(--store-primary)' }}>
                      {conditionLabels[selectedCondition] || selectedCondition}
                    </span>
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {availableConditionOptions.map((condition) => (
                      <button
                        key={condition}
                        type="button"
                        onClick={() => handleConditionChange(condition)}
                        className={cn(
                          'rounded-lg border-2 px-4 py-2 text-sm font-bold transition-all',
                          selectedCondition === condition
                            ? 'border-store-primary text-store-primary bg-store-primary/5'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        )}
                      >
                        {conditionLabels[condition] || condition}
                      </button>
                    ))}
                  </div>
                  {conditionDescriptions[selectedCondition] && (
                    <p className="text-xs text-muted-foreground">
                      {conditionDescriptions[selectedCondition]}
                    </p>
                  )}
                </div>
              ) : product.has_condition_offers &&
                product.offers &&
                product.offers.length > 0 ? (
                <div className="space-y-3">
                  <Label className="text-sm font-medium block">
                    Condition:{' '}
                    <span style={{ color: 'var(--store-primary)' }}>
                      {conditionLabels[selectedCondition] || selectedCondition}
                    </span>
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleConditionChange(
                          (product.condition || 'new') as ProductCondition
                        )
                      }
                      className={cn(
                        'rounded-lg border-2 px-4 py-2 text-sm font-bold transition-all',
                        selectedCondition === (product.condition || 'new')
                          ? 'border-store-primary text-store-primary bg-store-primary/5'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      )}
                    >
                      {conditionLabels[product.condition || 'new'] || 'New'}
                    </button>
                    {product.offers.map(
                      (offer: { id: string; condition: string }) => (
                        <button
                          key={offer.id}
                          type="button"
                          onClick={() =>
                            handleConditionChange(
                              offer.condition as ProductCondition
                            )
                          }
                          className={cn(
                            'rounded-lg border-2 px-4 py-2 text-sm font-bold transition-all',
                            selectedCondition === offer.condition
                              ? 'border-store-primary text-store-primary bg-store-primary/5'
                              : 'border-gray-200 text-gray-500 hover:border-gray-300'
                          )}
                        >
                          {conditionLabels[offer.condition] || offer.condition}
                        </button>
                      )
                    )}
                  </div>
                  {selectedOffer && selectedOffer.price != null && (
                    <p className="text-sm font-medium text-green-600">
                      Save{' '}
                      {formatCurrency(
                        product.price - Number(selectedOffer.price)
                      )}{' '}
                      vs New
                    </p>
                  )}
                  {conditionDescriptions[selectedCondition] && (
                    <p className="text-xs text-muted-foreground">
                      {conditionDescriptions[selectedCondition]}
                    </p>
                  )}
                </div>
              ) : product.condition && product.condition !== 'new' ? (
                <p className="text-sm">
                  <strong>Condition:</strong>{' '}
                  <span className="capitalize">{product.condition}</span>
                  {product.condition_detail && ` - ${product.condition_detail}`}
                </p>
              ) : null}

              {/* Variant Selection */}
              {product.has_variants && attributeOptions.length > 0 && (
                <div className="space-y-4">
                  {attributeOptions.map(({ key, values }) => (
                    <div key={key}>
                      <Label className="text-sm font-medium mb-2 block capitalize">
                        {key}:{' '}
                        <span className="font-normal">
                          {effectiveVariantAttributes[key]}
                        </span>
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {values.map((value) => {
                          const isSelected =
                            effectiveVariantAttributes[key] === value;
                          const isAvailable = isVariantAvailable(
                            product.variants || [],
                            { ...effectiveVariantAttributes, [key]: value },
                            isStockManaged,
                            getEffectiveStock(product),
                            {
                              condition: usesVariantConditions
                                ? selectedCondition
                                : undefined,
                              usesVariantConditions,
                            }
                          );

                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => handleAttributeChange(key, value)}
                              disabled={!isAvailable}
                              className={cn(
                                'px-4 py-2 rounded-md text-sm font-medium transition-all',
                                isSelected
                                  ? 'bg-store-primary text-store-primary-text ring-2 ring-store-primary ring-offset-2'
                                  : isAvailable
                                    ? 'bg-muted hover:bg-muted/80'
                                    : 'bg-muted/50 text-muted-foreground/50 cursor-not-allowed line-through'
                              )}
                            >
                              {isSelected && (
                                <Check className="size-3 inline mr-1" />
                              )}
                              {value}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div>
                {isOutOfStock ? (
                  <ThemedBadge colorRole="primary" variant="destructive">
                    Out of Stock
                  </ThemedBadge>
                ) : (
                  <ThemedBadge colorRole="primary" variant="outline">
                    {isStockManaged ? 'In Stock' : 'Unlimited stock'}
                  </ThemedBadge>
                )}
                {isStockManaged ? (
                  currentStock > 0 ? (
                    <p
                      className={cn(
                        'text-sm mt-2',
                        currentStock <= (product.low_stock_threshold || 5)
                          ? 'text-amber-600 font-medium'
                          : 'text-muted-foreground'
                      )}
                    >
                      {currentStock} units available
                      {currentStock <= (product.low_stock_threshold || 5) &&
                        ' (Low Stock)'}
                    </p>
                  ) : null
                ) : (
                  <p className="text-sm mt-2 text-muted-foreground">
                    Unlimited stock available
                  </p>
                )}
              </div>

              {product.minimum_order_quantity &&
                product.minimum_order_quantity > 1 && (
                  <Alert className="bg-blue-50 border-blue-200 text-blue-800">
                    <Info className="size-4 text-blue-600" />
                    <AlertDescription>
                      Minimum order quantity:{' '}
                      <strong>{product.minimum_order_quantity} units</strong>
                    </AlertDescription>
                  </Alert>
                )}

              <div className="flex flex-col gap-2">
                {cartItem ? (
                  <div className="flex flex-col gap-2">
                    {effectiveVariant && (
                      <p className="text-sm text-muted-foreground">
                        Selected:{' '}
                        {Object.values(cartItem.variantAttributes || {}).join(
                          ', '
                        )}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <ThemedButton
                        colorRole="accent"
                        size="icon"
                        variant="outline"
                        className="size-10"
                        onClick={() =>
                          updateQuantity(
                            effectiveVariantId
                              ? product.id
                              : (cartItem.cartItemId ?? product.id),
                            cartItem.quantity - 1,
                            effectiveVariantId
                          )
                        }
                        aria-label={`Decrease quantity of ${product.name}`}
                      >
                        <Minus className="size-4" aria-hidden="true" />
                      </ThemedButton>
                      <Input
                        type="number"
                        value={cartItem.quantity}
                        onChange={(e) =>
                          updateQuantity(
                            effectiveVariantId
                              ? product.id
                              : (cartItem.cartItemId ?? product.id),
                            Math.max(
                              Number.parseInt(e.target.value, 10) ||
                                product.minimum_order_quantity ||
                                1,
                              product.minimum_order_quantity || 1
                            ),
                            effectiveVariantId
                          )
                        }
                        className="h-10 w-16 text-center text-base remove-arrow"
                        min={product.minimum_order_quantity || 1}
                        aria-label={`Quantity for ${product.name}`}
                      />
                      <ThemedButton
                        colorRole="accent"
                        size="icon"
                        variant="default"
                        className="size-10"
                        onClick={() =>
                          updateQuantity(
                            effectiveVariantId
                              ? product.id
                              : (cartItem.cartItemId ?? product.id),
                            cartItem.quantity + 1,
                            effectiveVariantId
                          )
                        }
                        aria-label={`Increase quantity of ${product.name}`}
                      >
                        <Plus className="size-4" aria-hidden="true" />
                      </ThemedButton>
                    </div>
                    {/* Route through the cart, not checkout: the cart carries
                        the optional-service (assurance) disclosure and
                        toggle, so a direct checkout link would let a
                        default-on fee reach payment without an opt-out. */}
                    <Link href={asRoute(getHref('/cart'))}>
                      <ThemedButton
                        size="lg"
                        colorRole="primary"
                        className="w-full"
                      >
                        View Cart and Checkout
                      </ThemedButton>
                    </Link>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="flex items-center gap-1">
                      <ThemedButton
                        colorRole="accent"
                        size="icon"
                        variant="outline"
                        className="size-10"
                        onClick={() => handleQuantityChange(quantity - 1)}
                        aria-label={`Decrease quantity of ${product.name}`}
                      >
                        <Minus className="size-4" aria-hidden="true" />
                      </ThemedButton>
                      <Input
                        type="number"
                        value={quantity}
                        onChange={(e) =>
                          handleQuantityChange(
                            Number.parseInt(e.target.value, 10) || 0
                          )
                        }
                        className="h-10 w-16 text-center text-base remove-arrow"
                        min={product.minimum_order_quantity || 1}
                        aria-label={`Quantity for ${product.name}`}
                      />
                      <ThemedButton
                        colorRole="accent"
                        size="icon"
                        variant="default"
                        className="size-10"
                        onClick={() => handleQuantityChange(quantity + 1)}
                        aria-label={`Increase quantity of ${product.name}`}
                      >
                        <Plus className="size-4" aria-hidden="true" />
                      </ThemedButton>
                    </div>
                    <ThemedButton
                      size="lg"
                      colorRole="primary"
                      className="w-full"
                      disabled={
                        isOutOfStock ||
                        (product.has_variants && !currentVariantSelection)
                      }
                      onClick={handleAddToCart}
                    >
                      Add to Cart
                    </ThemedButton>
                  </div>
                )}
              </div>
            </div>
          </div>

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
        </main>
      </div>

      {/* Sticky Add-to-Cart (Mobile) */}
      <DeferredStickyAddToCart
        product={product}
        selectedAttributes={effectiveVariantAttributes}
        selectedCondition={
          selectedOffer || usesVariantConditions ? selectedCondition : undefined
        }
        selectedPrice={currentPrice}
        selectedStock={currentStock}
        selectedVariant={currentVariantSelection?.variant ?? effectiveVariant}
      />
    </>
  );
}

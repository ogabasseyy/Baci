'use client';

import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { useEffect, useState } from 'react';
import { Breadcrumbs } from '@/components/storefront/breadcrumbs';
import { DeferredStickyAddToCart } from '@/components/storefront/deferred-sticky-add-to-cart';
import { useCart } from '@/hooks/cart';
import { useCurrency } from '@/hooks/use-currency';
import { useMerchant } from '@/hooks/use-merchant-client';
import { useRecentlyViewed } from '@/hooks/use-recently-viewed';
import { trackEvent } from '@/lib/event-tracking';
import type { Product } from '@/lib/products';
import type { FAQItem } from '@/types/faq';
import { ProductDetailBelowFold } from './product-detail-below-fold';
import { ProductDetailConditionPanel } from './product-detail-condition-panel';
import { ProductDetailGallery } from './product-detail-gallery';
import { ProductDetailHeader } from './product-detail-header';
import { ProductDetailPurchasePanel } from './product-detail-purchase-panel';
import { ProductDetailStockPanel } from './product-detail-stock-panel';
import { ProductDetailVariantSelectors } from './product-detail-variant-selectors';
import { useProductCartSubmission } from './use-product-cart-submission';
import { useProductOfferSelection } from './use-product-offer-selection';

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
  const { cart, updateQuantity } = useCart();
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
    routeOfferMissing,
    routeVariantMissing,
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

  const handleAddToCart = useProductCartSubmission({
    product,
    merchant,
    currencyCode,
    currentVariantSelection,
    selectedOffer,
    selectedCondition,
    effectiveVariantAttributes,
    currentPrice,
    quantity,
  });

  // Product is guaranteed to exist by server component, but guard against archived status
  // Note: Can't call notFound() after hooks in client components, so we render null
  // The server component already handles the notFound() case for missing products
  if (!product || product.status === 'archived') {
    return null;
  }

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
    if (item.id !== product.id || item.variantId) return false;

    // Two offers can share one displayed condition: match the selected
    // offer by id, and require no offer id for the base line, or the
    // quantity controls render for (and update) the wrong offer.
    if (selectedOffer) return item.offerId === selectedOffer.id;
    if (item.offerId) return false;

    // Base/simple products store no condition in cart. Only offer-driven
    // selections need an explicit condition match on non-variant rows.
    return (
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
            <ProductDetailGallery
              product={product}
              selectedImage={selectedImage}
              onSelectImage={setSelectedImage}
            />

            <div className="flex flex-col justify-center gap-y-6 py-4">
              <ProductDetailHeader
                product={product}
                formatCurrency={formatCurrency}
                currentPrice={currentPrice}
                currentCompareAtPrice={currentCompareAtPrice}
              />

              {/* Condition Selector */}
              <ProductDetailConditionPanel
                product={product}
                usesVariantConditions={usesVariantConditions}
                availableConditionOptions={availableConditionOptions}
                conditionLabels={conditionLabels}
                conditionDescriptions={conditionDescriptions}
                selectedCondition={selectedCondition}
                onConditionChange={handleConditionChange}
                selectedOffer={selectedOffer}
                formatCurrency={formatCurrency}
                routeOfferMissing={routeOfferMissing}
                routeVariantMissing={routeVariantMissing}
              />

              {/* Variant Selection */}
              <ProductDetailVariantSelectors
                product={product}
                attributeOptions={attributeOptions}
                effectiveVariantAttributes={effectiveVariantAttributes}
                onAttributeChange={handleAttributeChange}
                isStockManaged={isStockManaged}
                selectedCondition={selectedCondition}
                usesVariantConditions={usesVariantConditions}
              />

              <ProductDetailStockPanel
                product={product}
                isOutOfStock={isOutOfStock}
                isStockManaged={isStockManaged}
                currentStock={currentStock}
              />

              <ProductDetailPurchasePanel
                product={product}
                cartItem={cartItem}
                hasEffectiveVariant={Boolean(effectiveVariant)}
                effectiveVariantId={effectiveVariantId}
                quantity={quantity}
                onQuantityChange={handleQuantityChange}
                updateQuantity={updateQuantity}
                getHref={getHref}
                isOutOfStock={isOutOfStock}
                routeOfferMissing={routeOfferMissing}
                routeVariantMissing={routeVariantMissing}
                hasCurrentVariantSelection={Boolean(currentVariantSelection)}
                onAddToCart={handleAddToCart}
              />
            </div>
          </div>

          <ProductDetailBelowFold product={product} />
        </main>
      </div>

      {/* Sticky Add-to-Cart (Mobile) */}
      <DeferredStickyAddToCart
        product={product}
        selectedAttributes={effectiveVariantAttributes}
        selectedCondition={
          selectedOffer || usesVariantConditions ? selectedCondition : undefined
        }
        selectedOfferId={selectedOffer?.id}
        selectedPrice={currentPrice}
        selectedStock={currentStock}
        selectedVariant={currentVariantSelection?.variant ?? effectiveVariant}
        purchaseDisabled={routeOfferMissing || routeVariantMissing}
      />
    </>
  );
}

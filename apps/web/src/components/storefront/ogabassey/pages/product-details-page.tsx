'use client';

import '@/app/(storefront)/storefront-ogabassey-pdp-deferred.css';
import { type ReactNode } from 'react';
import type { Product } from '../types';
import { ProductBreadcrumbs } from './product-details-page/product-breadcrumbs';
import { ProductInteractionPanel } from './product-details-page/product-interaction-panel';
import { ProductMediaGallery } from './product-details-page/product-media-gallery';
import { ProductMobileActionBar } from './product-details-page/product-mobile-action-bar';
import { ProductPurchasePanel } from './product-details-page/product-purchase-panel';
import { useProductDetailsState } from './product-details-page/use-product-details-state';
import { DeferredProductDetailsSectionsLoader } from './product-details-page/deferred-product-details-sections-loader';
import deferredLayoutStyles from './product-details-page/deferred-product-details-layout.module.css';
import { AdUnit } from './product-details-page/product-details-lazy-ad-unit';
import { ProductDetailsBannerSection } from './product-details-page/product-details-banner-section';
import { ProductDetailsPageOverlays } from './product-details-page/product-details-page-overlays';
import { useIsDesktopViewport } from './product-details-page/use-is-desktop-viewport';
import { useProductDetailsAttributeHandlers } from './product-details-page/use-product-details-attribute-handlers';

interface ProductDetailsPageProps {
  mode?: 'full' | 'commerce' | 'belowFold';
  product: Product;
  semanticSections?: ReactNode;
}

export function ProductDetailsPage({
  mode = 'full',
  product,
  semanticSections = null,
}: ProductDetailsPageProps) {
  const {
    activeTab,
    availableConditions,
    animatingParticles,
    basePath,
    canPurchase,
    cartHref,
    currentOffer,
    currentVariantDisplaySelection,
    deliveryEstimate,
    deliveryLocation,
    effectiveAxes,
    formatAxisLabel,
    getAxisOptions,
    handleAnimationComplete,
    handleColorDoubleClick,
    handleColorSelection,
    handleDecrement,
    handleIncrement,
    handleKeyDown,
    handleMobileAddToCart,
    handleNegotiationSuccess,
    handleQuantityBlur,
    handleQuantityChange,
    handleShare,
    handleToggleSaved,
    homeHref,
    inputValue,
    isLiked,
    isNegotiationOpen,
    isSelectionModalOpen,
    merchantId,
    merchantSlug,
    merchantVatRate,
    missingFields,
    normalizedReviewRatingWidth,
    productData,
    quantityInCart,
    relatedProductsProduct,
    secondaryColor,
    selectedAttributes,
    selectedColor,
    selectedCondition,
    selectedImage,
    setActiveTab,
    setDeliveryLocation,
    setIsNegotiationOpen,
    setIsSelectionModalOpen,
    setMissingFields,
    setSelectedAttributes,
    setSelectedCondition,
    setSelectedImage,
    showColorToast,
    validateAndAddToCart,
    variantSelectionAttributes,
  } = useProductDetailsState(product);

  const isDesktop = useIsDesktopViewport();
  const {
    handleAttributeSelection,
    handleModalAttributeSelection,
    handleModalColorSelection,
  } = useProductDetailsAttributeHandlers({
    formatAxisLabel,
    handleColorSelection,
    productData,
    setMissingFields,
    setSelectedAttributes,
  });

  const isCommerceMode = mode === 'commerce';

  if (mode === 'belowFold') {
    return (
      <div className={deferredLayoutStyles.container}>
        {semanticSections}
        <DeferredProductDetailsSectionsLoader
          activeTab={activeTab}
          normalizedReviewRatingWidth={normalizedReviewRatingWidth}
          onSelectTab={setActiveTab}
          productData={productData}
          relatedProductsProduct={relatedProductsProduct}
          showRails={false}
          storeSlug={merchantSlug}
        />
      </div>
    );
  }

  return (
    <div
      className={
        isCommerceMode ? 'relative' : 'relative bg-store-background pb-32 pt-4'
      }
    >
      {isCommerceMode ? null : (
        <ProductDetailsBannerSection isDesktop={isDesktop} />
      )}

      <div
        className={
          isCommerceMode ? 'w-full' : 'mx-auto max-w-[1400px] px-4 md:px-6'
        }
      >
        {isCommerceMode ? null : (
          <ProductBreadcrumbs
            basePath={basePath}
            homeHref={homeHref}
            productData={productData}
          />
        )}

        <div
          className={
            isCommerceMode
              ? 'contents'
              : 'grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-8'
          }
        >
          {isCommerceMode ? null : (
            <ProductMediaGallery
              onSelectImage={setSelectedImage}
              productData={productData}
              selectedCondition={selectedCondition}
              selectedImage={selectedImage}
            />
          )}

          {isCommerceMode ? (
            <ProductInteractionPanel
              availableConditions={availableConditions}
              canPurchase={canPurchase}
              cartHref={cartHref}
              currentOfferPrice={currentOffer.price}
              deliveryEstimate={deliveryEstimate}
              deliveryLocation={deliveryLocation}
              effectiveAxes={effectiveAxes}
              formatAxisLabel={formatAxisLabel}
              getAxisOptions={getAxisOptions}
              inputValue={inputValue}
              isLiked={isLiked}
              onAddToCart={validateAndAddToCart}
              onChangeAttribute={handleAttributeSelection}
              onChangeDeliveryLocation={setDeliveryLocation}
              onDecrement={handleDecrement}
              onIncrement={handleIncrement}
              onInputBlur={handleQuantityBlur}
              onInputChange={handleQuantityChange}
              onInputKeyDown={handleKeyDown}
              onSelectColor={handleColorSelection}
              onSelectSecondaryColor={handleColorDoubleClick}
              onSetCondition={setSelectedCondition}
              onShare={handleShare}
              onToggleSaved={handleToggleSaved}
              productData={productData}
              quantityInCart={quantityInCart}
              secondaryColor={secondaryColor}
              selectedAttributes={selectedAttributes}
              selectedColor={selectedColor}
              selectedCondition={selectedCondition}
              showColorToast={showColorToast}
            />
          ) : (
            <ProductPurchasePanel
              availableConditions={availableConditions}
              canPurchase={canPurchase}
              cartHref={cartHref}
              currentOfferPrice={currentOffer.price}
              deliveryEstimate={deliveryEstimate}
              deliveryLocation={deliveryLocation}
              effectiveAxes={effectiveAxes}
              formatAxisLabel={formatAxisLabel}
              getAxisOptions={getAxisOptions}
              inputValue={inputValue}
              isLiked={isLiked}
              onAddToCart={validateAndAddToCart}
              onChangeAttribute={handleAttributeSelection}
              onChangeDeliveryLocation={setDeliveryLocation}
              onDecrement={handleDecrement}
              onIncrement={handleIncrement}
              onInputBlur={handleQuantityBlur}
              onInputChange={handleQuantityChange}
              onInputKeyDown={handleKeyDown}
              onSelectColor={handleColorSelection}
              onSelectSecondaryColor={handleColorDoubleClick}
              onSetCondition={setSelectedCondition}
              onShare={handleShare}
              onToggleSaved={handleToggleSaved}
              productData={productData}
              quantityInCart={quantityInCart}
              secondaryColor={secondaryColor}
              selectedAttributes={selectedAttributes}
              selectedColor={selectedColor}
              selectedCondition={selectedCondition}
              showColorToast={showColorToast}
            />
          )}

          {isCommerceMode ? null : (
            <div className="hidden lg:col-span-3 lg:block lg:border-l lg:border-store-background-text/10 lg:pl-8">
              <div className="sticky top-24">
                <p className="mb-4 text-xs font-bold uppercase tracking-widest text-store-background-text/50">
                  Sponsored
                </p>
                <AdUnit placementKey="SIDEBAR_HALF_PAGE" className="mb-6" />
              </div>
            </div>
          )}
        </div>

        {isCommerceMode ? null : semanticSections}

        {isCommerceMode ? null : (
          <DeferredProductDetailsSectionsLoader
            activeTab={activeTab}
            normalizedReviewRatingWidth={normalizedReviewRatingWidth}
            onSelectTab={setActiveTab}
            productData={productData}
            relatedProductsProduct={relatedProductsProduct}
            storeSlug={merchantSlug}
          />
        )}
      </div>

      <ProductMobileActionBar
        cartHref={cartHref}
        canPurchase={canPurchase}
        onDecrement={handleDecrement}
        onIncrement={handleIncrement}
        onMobileAddToCart={handleMobileAddToCart}
        quantityInCart={quantityInCart}
      />

      <ProductDetailsPageOverlays
        animatingParticles={animatingParticles}
        currentOfferRawPrice={currentOffer.rawPrice}
        currentVariantDisplaySelection={currentVariantDisplaySelection}
        effectiveAxes={effectiveAxes}
        formatAxisLabel={formatAxisLabel}
        getAxisOptions={getAxisOptions}
        isNegotiationOpen={isNegotiationOpen}
        isSelectionModalOpen={isSelectionModalOpen}
        merchantId={merchantId || ''}
        merchantVatRate={merchantVatRate}
        missingFields={missingFields}
        onAnimationComplete={handleAnimationComplete}
        onCloseNegotiation={() => setIsNegotiationOpen(false)}
        onCloseSelectionModal={() => setIsSelectionModalOpen(false)}
        onConfirmSelection={() => {
          if (missingFields.length === 0) {
            setIsSelectionModalOpen(false);
            validateAndAddToCart();
          }
        }}
        onNegotiationSuccess={handleNegotiationSuccess}
        onSelectAttribute={handleModalAttributeSelection}
        onSelectColor={handleModalColorSelection}
        productData={productData}
        selectedAttributes={selectedAttributes}
        selectedColor={selectedColor}
        selectedCondition={selectedCondition}
        selectedImage={selectedImage}
        variantSelectionAttributes={variantSelectionAttributes}
      />
    </div>
  );
}

'use client';

import type { NormalizedProductDetails } from './product-normalization';
import { FlyToCartAnimation } from './product-details-lazy-fly-to-cart-animation';
import { NegotiationModal } from './product-details-lazy-negotiation-modal';
import { SelectionRequiredModal } from './product-details-lazy-selection-required-modal';

interface ProductDetailsPageOverlaysProps {
  animatingParticles: DOMRect[];
  currentOfferRawPrice: number;
  currentVariantDisplaySelection?: {
    variant: { id?: string; name?: string };
  } | null;
  effectiveAxes: string[];
  formatAxisLabel: (axis: string) => string;
  getAxisOptions: (axis: string) => string[];
  isNegotiationOpen: boolean;
  isSelectionModalOpen: boolean;
  merchantId: string;
  merchantVatRate: number;
  missingFields: string[];
  onAnimationComplete: () => void;
  onCloseNegotiation: () => void;
  onCloseSelectionModal: () => void;
  onConfirmSelection: () => void;
  onNegotiationSuccess: (price: number) => void;
  onSelectAttribute: (axis: string, value: string) => void;
  onSelectColor: (index: number) => void;
  productData: NormalizedProductDetails;
  selectedAttributes: Record<string, string>;
  selectedColor: number | null;
  selectedCondition: string;
  selectedImage: number;
  variantSelectionAttributes: Record<string, string>;
}

export function ProductDetailsPageOverlays({
  animatingParticles,
  currentOfferRawPrice,
  currentVariantDisplaySelection,
  effectiveAxes,
  formatAxisLabel,
  getAxisOptions,
  isNegotiationOpen,
  isSelectionModalOpen,
  merchantId,
  merchantVatRate,
  missingFields,
  onAnimationComplete,
  onCloseNegotiation,
  onCloseSelectionModal,
  onConfirmSelection,
  onNegotiationSuccess,
  onSelectAttribute,
  onSelectColor,
  productData,
  selectedAttributes,
  selectedColor,
  selectedCondition,
  selectedImage,
  variantSelectionAttributes,
}: ProductDetailsPageOverlaysProps) {
  return (
    <>
      {animatingParticles.map((rect, index) => (
        <FlyToCartAnimation
          key={`${rect.x}-${rect.y}-${index}`}
          startRect={rect}
          onComplete={onAnimationComplete}
          imageSrc={productData.images[selectedImage] ?? productData.images[0]}
        />
      ))}

      {isSelectionModalOpen ? (
        <SelectionRequiredModal
          effectiveAxes={effectiveAxes}
          formatAxisLabel={formatAxisLabel}
          getAxisOptions={getAxisOptions}
          isOpen
          missingFields={missingFields}
          onClose={onCloseSelectionModal}
          onConfirm={onConfirmSelection}
          onSelectAttribute={onSelectAttribute}
          onSelectColor={onSelectColor}
          productData={productData}
          selectedAttributes={selectedAttributes}
          selectedColor={selectedColor}
        />
      ) : null}

      {isNegotiationOpen ? (
        <NegotiationModal
          isOpen
          onClose={onCloseNegotiation}
          productName={productData.name}
          productBrand={productData.brand}
          currentPrice={currentOfferRawPrice}
          vatRate={merchantVatRate}
          onSuccess={onNegotiationSuccess}
          type="single"
          itemId={String(productData.id)}
          merchantId={merchantId}
          productSlug={productData.slug}
          variantId={currentVariantDisplaySelection?.variant.id}
          variantName={currentVariantDisplaySelection?.variant.name}
          variantAttributes={variantSelectionAttributes}
          condition={selectedCondition}
        />
      ) : null}
    </>
  );
}

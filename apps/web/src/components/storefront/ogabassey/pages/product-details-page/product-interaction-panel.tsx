'use client';

import type { Route } from 'next';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { ProductVariant } from '@/lib/products';
import {
  buildDescriptionExcerpt,
  type ConditionType,
  type NormalizedProductDetails,
} from './product-details-helpers';
import { ProductCartActions } from './product-cart-actions';
import { ProductOptionSelectors } from './product-option-selectors';
import { ProductSummaryPanel } from './product-summary-panel';

interface ProductInteractionPanelProps {
  availableConditions: ConditionType[];
  canPurchase: boolean;
  cartHref: Route;
  currentOfferPrice: string;
  deliveryEstimate: string;
  deliveryLocation: 'Lagos' | 'Outside Lagos';
  effectiveAxes: string[];
  formatAxisLabel: (axis: string) => string;
  getAxisOptions: (axis: string) => string[];
  inputValue: string;
  isLiked: boolean;
  onAddToCart: () => void;
  onChangeAttribute: (axis: string, value: string) => void;
  onChangeDeliveryLocation: (
    updater: (current: 'Lagos' | 'Outside Lagos') => 'Lagos' | 'Outside Lagos'
  ) => void;
  onDecrement: () => void;
  onIncrement: () => void;
  onInputBlur: () => void;
  onInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSelectColor: (index: number) => void;
  onSelectSecondaryColor: (index: number) => void;
  onSetCondition: (condition: ConditionType) => void;
  onShare: () => void;
  onToggleSaved: () => void;
  productData: NormalizedProductDetails;
  quantityInCart: number;
  secondaryColor: number | null;
  selectedAttributes: Record<string, string>;
  selectedColor: number | null;
  selectedCondition: ConditionType;
  selectedVariant?: ProductVariant | null;
  showColorToast: boolean;
}

export function ProductInteractionPanel(props: ProductInteractionPanelProps) {
  return (
    <div className="flex flex-col" data-ogabassey-pdp-client-controls>
      <ProductSummaryPanel
        availableConditions={props.availableConditions}
        currentOfferPrice={props.currentOfferPrice}
        isLiked={props.isLiked}
        onShare={props.onShare}
        onToggleSaved={props.onToggleSaved}
        productData={props.productData}
        selectedCondition={props.selectedCondition}
        setSelectedCondition={props.onSetCondition}
        summaryOnly
      />
      <ProductOptionSelectors
        deliveryEstimate={props.deliveryEstimate}
        deliveryLocation={props.deliveryLocation}
        descriptionExcerpt={buildDescriptionExcerpt(
          props.productData.description || ''
        )}
        effectiveAxes={props.effectiveAxes}
        formatAxisLabel={props.formatAxisLabel}
        getAxisOptions={props.getAxisOptions}
        onChangeDeliveryLocation={props.onChangeDeliveryLocation}
        onSelectAttribute={props.onChangeAttribute}
        onSelectColor={props.onSelectColor}
        onSelectSecondaryColor={props.onSelectSecondaryColor}
        productData={props.productData}
        secondaryColor={props.secondaryColor}
        selectedAttributes={props.selectedAttributes}
        selectedColor={props.selectedColor}
        selectedVariant={props.selectedVariant}
        showColorToast={props.showColorToast}
      />
      <ProductCartActions
        cartHref={props.cartHref}
        canPurchase={props.canPurchase}
        inputValue={props.inputValue}
        onAddToCart={props.onAddToCart}
        onDecrement={props.onDecrement}
        onIncrement={props.onIncrement}
        onInputBlur={props.onInputBlur}
        onInputChange={props.onInputChange}
        onInputKeyDown={props.onInputKeyDown}
        quantityInCart={props.quantityInCart}
      />
    </div>
  );
}

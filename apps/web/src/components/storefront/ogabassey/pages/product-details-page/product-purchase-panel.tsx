import type { Route } from 'next';
import type { ProductVariant } from '@/lib/products';
import {
  buildDescriptionExcerpt,
  type ConditionType,
  type NormalizedProductDetails,
} from './product-details-helpers';
import { ProductCartActions } from './product-cart-actions';
import { ProductOptionSelectors } from './product-option-selectors';
import { ProductSummaryPanel } from './product-summary-panel';

interface ProductPurchasePanelProps {
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
  onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
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

export function ProductPurchasePanel({
  availableConditions,
  canPurchase,
  cartHref,
  currentOfferPrice,
  deliveryEstimate,
  deliveryLocation,
  effectiveAxes,
  formatAxisLabel,
  getAxisOptions,
  inputValue,
  isLiked,
  onAddToCart,
  onChangeAttribute,
  onChangeDeliveryLocation,
  onDecrement,
  onIncrement,
  onInputBlur,
  onInputChange,
  onInputKeyDown,
  onSelectColor,
  onSelectSecondaryColor,
  onSetCondition,
  onShare,
  onToggleSaved,
  productData,
  quantityInCart,
  secondaryColor,
  selectedAttributes,
  selectedColor,
  selectedCondition,
  selectedVariant,
  showColorToast,
}: ProductPurchasePanelProps) {
  return (
    <div className="flex flex-col lg:col-span-4">
      <ProductSummaryPanel
        availableConditions={availableConditions}
        currentOfferPrice={currentOfferPrice}
        isLiked={isLiked}
        onShare={onShare}
        onToggleSaved={onToggleSaved}
        productData={productData}
        selectedCondition={selectedCondition}
        setSelectedCondition={onSetCondition}
      />
      <ProductOptionSelectors
        deliveryEstimate={deliveryEstimate}
        deliveryLocation={deliveryLocation}
        descriptionExcerpt={buildDescriptionExcerpt(productData.description || '')}
        effectiveAxes={effectiveAxes}
        formatAxisLabel={formatAxisLabel}
        getAxisOptions={getAxisOptions}
        onChangeDeliveryLocation={onChangeDeliveryLocation}
        onSelectAttribute={onChangeAttribute}
        onSelectColor={onSelectColor}
        onSelectSecondaryColor={onSelectSecondaryColor}
        productData={productData}
        secondaryColor={secondaryColor}
        selectedAttributes={selectedAttributes}
        selectedColor={selectedColor}
        selectedVariant={selectedVariant}
        showColorToast={showColorToast}
      />
      <ProductCartActions
        cartHref={cartHref}
        canPurchase={canPurchase}
        inputValue={inputValue}
        onAddToCart={onAddToCart}
        onDecrement={onDecrement}
        onIncrement={onIncrement}
        onInputBlur={onInputBlur}
        onInputChange={onInputChange}
        onInputKeyDown={onInputKeyDown}
        quantityInCart={quantityInCart}
      />
    </div>
  );
}

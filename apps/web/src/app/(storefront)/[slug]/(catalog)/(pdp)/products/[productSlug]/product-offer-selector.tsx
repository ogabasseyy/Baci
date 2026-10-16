'use client';

import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { Label } from '@/components/ui/label';
import type { Product } from '@/lib/products';
import { cn } from '@/lib/utils';
import type { ProductCondition } from './product-selection-condition';

type ConditionOffer = NonNullable<Product['offers']>[number];

export function ProductOfferSelector({
  conditionDescriptions,
  conditionLabels,
  formatCurrency,
  onConditionChange,
  product,
  selectedCondition,
  selectedOffer,
}: {
  conditionDescriptions: Record<string, string>;
  conditionLabels: Record<string, string>;
  formatCurrency: (value: number) => string;
  onConditionChange: (
    condition: ProductCondition,
    offerId?: string | null
  ) => void;
  product: Product;
  selectedCondition: ProductCondition;
  selectedOffer: ConditionOffer | null;
}) {
  return (
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
            onConditionChange((product.condition || 'new') as ProductCondition)
          }
          className={cn(
            'rounded-lg border-2 px-4 py-2 text-sm font-bold transition-all',
            selectedCondition ===
              normalizeCanonicalProductCondition(product.condition || 'new')
              ? 'border-store-primary text-store-primary bg-store-primary/5'
              : 'border-gray-200 text-gray-500 hover:border-gray-300'
          )}
        >
          {conditionLabels[product.condition || 'new'] || 'New'}
        </button>
        {product.offers?.map((offer: ConditionOffer) => {
          // Two offers can share one displayed condition: the
          // selected style must follow the resolved offer id
          // (like the cart-item match below), or every
          // same-condition button lights up at once.
          const isOfferSelected =
            selectedOffer != null
              ? String(selectedOffer.id) === String(offer.id)
              : selectedCondition ===
                normalizeCanonicalProductCondition(offer.condition);
          // Same-condition offers render identical labels, so
          // the shopper could not tell which one is selected:
          // disambiguate with the offer price when they collide.
          const sameConditionCount = (product.offers ?? []).filter(
            (other: { condition: string }) =>
              normalizeCanonicalProductCondition(other.condition) ===
              normalizeCanonicalProductCondition(offer.condition)
          ).length;
          const offerLabel =
            conditionLabels[offer.condition] || offer.condition;
          return (
            <button
              key={offer.id}
              type="button"
              onClick={() =>
                onConditionChange(offer.condition as ProductCondition, offer.id)
              }
              className={cn(
                'rounded-lg border-2 px-4 py-2 text-sm font-bold transition-all',
                isOfferSelected
                  ? 'border-store-primary text-store-primary bg-store-primary/5'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              )}
            >
              {sameConditionCount > 1
                ? `${offerLabel} · ${formatCurrency(offer.price)}`
                : offerLabel}
            </button>
          );
        })}
      </div>
      {selectedOffer &&
        selectedOffer.price != null &&
        product.price - Number(selectedOffer.price) > 0 && (
          <p className="text-sm font-medium text-green-600">
            Save {formatCurrency(product.price - Number(selectedOffer.price))}{' '}
            vs New
          </p>
        )}
      {conditionDescriptions[selectedCondition] && (
        <p className="text-xs text-muted-foreground">
          {conditionDescriptions[selectedCondition]}
        </p>
      )}
    </div>
  );
}

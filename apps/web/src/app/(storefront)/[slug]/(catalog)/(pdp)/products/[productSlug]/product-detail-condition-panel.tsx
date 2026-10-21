import { Info } from 'lucide-react';
import { Label } from '@/components/ui/label';
import type { Product } from '@/lib/products';
import { cn } from '@/lib/utils';
import { ProductOfferSelector } from './product-offer-selector';
import type { ProductCondition } from './product-selection-condition';

type ConditionOffer = NonNullable<Product['offers']>[number];

/**
 * PDP condition selection: variant-condition buttons, exact-offer
 * selector, or a static condition line, plus stale route-selection
 * alerts. Split from ProductDetailClient (modularity rule).
 */
export function ProductDetailConditionPanel({
  product,
  usesVariantConditions,
  availableConditionOptions,
  conditionLabels,
  conditionDescriptions,
  selectedCondition,
  onConditionChange,
  selectedOffer,
  formatCurrency,
  routeOfferMissing,
  routeVariantMissing,
}: {
  product: Product;
  usesVariantConditions: boolean;
  availableConditionOptions: ProductCondition[];
  conditionLabels: Record<string, string>;
  conditionDescriptions: Record<string, string>;
  selectedCondition: ProductCondition;
  onConditionChange: (
    condition: ProductCondition,
    offerId?: string | null
  ) => void;
  selectedOffer: ConditionOffer | null;
  formatCurrency: (value: number) => string;
  routeOfferMissing: boolean;
  routeVariantMissing: boolean;
}) {
  return (
    <>
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
                onClick={() => onConditionChange(condition)}
                className={cn(
                  'rounded-lg border-2 px-4 py-2 text-sm font-bold transition-all',
                  selectedCondition === condition
                    ? 'border-store-primary text-store-primary bg-store-primary/5'
                    : 'border-store-border text-store-background-text/60 hover:border-store-background-text/30'
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
        <ProductOfferSelector
          conditionDescriptions={conditionDescriptions}
          conditionLabels={conditionLabels}
          formatCurrency={formatCurrency}
          onConditionChange={onConditionChange}
          product={product}
          selectedCondition={selectedCondition}
          selectedOffer={selectedOffer}
        />
      ) : product.condition && product.condition !== 'new' ? (
        <p className="text-sm">
          <strong>Condition:</strong>{' '}
          <span className="capitalize">{product.condition}</span>
          {product.condition_detail && ` - ${product.condition_detail}`}
        </p>
      ) : null}

      {/* Exact-offer links whose offer is gone must not silently
          sell the parent/default selection instead. */}
      {routeOfferMissing && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-store-accent bg-store-secondary px-3 py-2 text-sm text-store-secondary-text"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          This offer is no longer available. It may have been removed or sold —
          choose a condition to continue.
        </p>
      )}
      {routeVariantMissing && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-store-accent bg-store-secondary px-3 py-2 text-sm text-store-secondary-text"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          This option is no longer available. It may have been removed or sold —
          choose an option to continue.
        </p>
      )}
    </>
  );
}

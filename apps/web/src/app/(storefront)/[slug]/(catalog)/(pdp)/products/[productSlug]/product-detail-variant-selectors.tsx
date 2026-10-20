import { Check } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { getEffectiveStock } from '@/lib/product-stock';
import type { Product } from '@/lib/products';
import { cn } from '@/lib/utils';
import type { ProductCondition } from './product-selection-condition';
import { isVariantAvailable } from './product-variant-availability';

/**
 * PDP variant attribute selectors (size, color, ...). Split from
 * ProductDetailClient (modularity rule).
 */
export function ProductDetailVariantSelectors({
  product,
  attributeOptions,
  effectiveVariantAttributes,
  onAttributeChange,
  isStockManaged,
  selectedCondition,
  usesVariantConditions,
}: {
  product: Product;
  attributeOptions: { key: string; values: string[] }[];
  effectiveVariantAttributes: Record<string, string>;
  onAttributeChange: (key: string, value: string) => void;
  isStockManaged: boolean;
  selectedCondition: ProductCondition;
  usesVariantConditions: boolean;
}) {
  if (!product.has_variants || attributeOptions.length === 0) {
    return null;
  }
  return (
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
              const isSelected = effectiveVariantAttributes[key] === value;
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
                  onClick={() => onAttributeChange(key, value)}
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
                  {isSelected && <Check className="size-3 inline mr-1" />}
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

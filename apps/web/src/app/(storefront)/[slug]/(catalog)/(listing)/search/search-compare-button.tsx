'use client';
import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { useState } from 'react';
import { useV2Comparison } from '@/components/storefront/ogabassey/providers/v2-comparison-context';
import type { Product } from '@/components/storefront/ogabassey/types';
import type { NormalizedProduct } from '@/lib/normalize-product';
import { useSearchComparisonIntent } from './use-search-comparison-intent';
export function SearchCompareButton({
  product,
  price,
  compact = false,
}: {
  product: NormalizedProduct;
  price: string;
  compact?: boolean;
}) {
  const comparison = useV2Comparison();
  const intent = useSearchComparisonIntent();
  const [notice, setNotice] = useState('');
  const selected = comparison.isInCompare(product.id);
  return (
    <div className={compact ? '' : 'pt-2'}>
      <button
        type="button"
        aria-pressed={selected}
        className={
          compact
            ? 'min-h-11 text-xs text-store-background-text'
            : 'min-h-11 rounded-lg border border-store-background-text/20 px-4 text-sm text-store-background-text'
        }
        onClick={() => {
          intent.activate();
          if (selected) {
            comparison.removeFromCompare(product.id);
            setNotice('');
            return;
          }
          const replaced = comparison.addToCompare({
            id: product.id,
            merchantId: product.merchant_id,
            slug: product.slug,
            name: product.name,
            price,
            rawPrice: product.price,
            image: product.image,
            description: product.description,
            brand: product.brand ?? undefined,
            category: product.category,
            categorySlug: product.category_slug,
            condition: product.condition as Product['condition'],
            matchVariantId: product.searchMatch?.variantId,
            matchOfferId: product.searchMatch?.offerId,
            // Persist the canonical condition: raw match aliases (uk_used)
            // would be dropped by the snapshot schema, losing the
            // match_base marker for off-page items after hydration.
            matchCondition:
              normalizeCanonicalProductCondition(
                product.searchMatch?.condition
              ) || undefined,
          });
          setNotice(
            replaced ? `Replaced ${replaced.name} in your comparison.` : ''
          );
        }}
      >
        {compact
          ? selected
            ? '✓ Selected'
            : '□ Compare'
          : selected
            ? '✓ Added to comparison'
            : '+ Add to comparison'}
      </button>
      {!compact &&
        intent.active &&
        selected &&
        comparison.compareItems.length >= 2 && (
          <button
            type="button"
            onClick={() => {
              document.getElementById('search-comparison')?.scrollIntoView({
                block: 'start',
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
                  .matches
                  ? 'auto'
                  : 'smooth',
              });
            }}
            className="mt-2 block min-h-11 rounded-lg bg-store-primary p-3 text-center font-semibold text-store-primary-text"
          >
            View comparison ({comparison.compareItems.length}) →
          </button>
        )}
      {notice && (
        <p role="status" className="text-sm text-store-background-text/70">
          {notice}
        </p>
      )}
    </div>
  );
}

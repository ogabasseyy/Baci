'use client';
import {
  buildComparisonRows,
  normalizeCanonicalProductCondition,
} from '@baci/shared/lib';
import Link from 'next/link';
import { useState } from 'react';
import { useV2Comparison } from '@/components/storefront/ogabassey/providers/v2-comparison-context';
import type { Product } from '@/components/storefront/ogabassey/types';
import type { NormalizedProduct } from '@/lib/normalize-product';
import { getProductUrl } from '@/lib/product-url';
import { asRoute } from '@/lib/routes';
import { useSearchComparisonIntent } from './search-comparison-session';
import { useSearchComparisonFacts } from './use-search-comparison-facts';
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
            matchCondition: product.searchMatch?.condition,
          });
          if (replaced)
            setNotice(`Replaced ${replaced.name} in your comparison.`);
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
export function SearchComparisonTray({
  currency = 'NGN',
  products,
  pathPrefix,
  merchantId,
}: {
  currency?: string;
  products: NormalizedProduct[];
  pathPrefix: string;
  merchantId: string;
}) {
  const { compareItems, removeFromCompare, clearCompare } = useV2Comparison();
  const [open, setOpen] = useState(true);
  const intent = useSearchComparisonIntent();
  const facts = useSearchComparisonFacts(
    merchantId,
    compareItems.map((p) => String(p.id)),
    intent.active && open && compareItems.length >= 2
  );
  const current = new Map(facts.products.map((p) => [p.id, p]));
  const matches = new Map(products.map((p) => [p.id, p.searchMatch]));
  const rows = buildComparisonRows(
    compareItems.map((snapshot) => {
      const product = current.get(String(snapshot.id));
      return {
        id: String(snapshot.id),
        specifications: Object.fromEntries(
          Object.entries(product?.product_key_specs ?? {})
            .filter(
              ([, value]) =>
                typeof value === 'string' || typeof value === 'number'
            )
            .map(([key, value]) => [key, String(value)])
        ),
      };
    })
  );
  if (!intent.active || compareItems.length < 2) return null;
  return (
    <section
      id="search-comparison"
      className="scroll-mt-24 my-4 rounded-xl border border-store-background-text/15 p-4 text-store-background-text"
    >
      <button
        type="button"
        className="min-h-11 font-semibold"
        disabled={compareItems.length < 2}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        View comparison ({compareItems.length})
      </button>
      <div className="flex justify-center">
        <button
          type="button"
          className="min-h-11 px-5 text-store-primary"
          onClick={clearCompare}
        >
          Clear all
        </button>
      </div>
      <p className="text-sm opacity-70">
        Select at least two products. Saved products outside these results need
        their current details checked.
      </p>
      {open && compareItems.length >= 2 && (
        <p role="status">
          {facts.pending
            ? 'Refreshing prices and specifications…'
            : facts.error
              ? 'Couldn’t refresh comparison. Open a product to check current details.'
              : 'Current parent starting prices. Choose condition and storage on the product page.'}
        </p>
      )}
      {open && compareItems.length >= 2 && (
        <div className="flex gap-4 overflow-x-auto py-4">
          {compareItems.map((snapshot) => {
            const product = current.get(String(snapshot.id));
            // PDP deep link preserves the compared option: the snapshot
            // basis is authoritative (a re-filtered live match describes a
            // different option than the one compared); live match serves
            // only legacy snapshots without match metadata.
            const liveMatch = matches.get(String(snapshot.id));
            const matchParams = new URLSearchParams();
            const variantId = snapshot.matchVariantId ?? liveMatch?.variantId;
            const offerId = snapshot.matchOfferId ?? liveMatch?.offerId;
            // Exact IDs resolve the live option; a saved condition can change
            // independently and must not invalidate that identity on the PDP.
            const condition =
              variantId || offerId
                ? undefined
                : normalizeCanonicalProductCondition(product?.condition);
            if (variantId) matchParams.set('variant_id', variantId);
            if (condition) matchParams.set('condition', condition);
            if (offerId) matchParams.set('offer_id', offerId);
            const detailsPath = `${pathPrefix}${getProductUrl(product ?? { ...snapshot, id: String(snapshot.id) })}`;
            const detailsHref = matchParams.size
              ? `${detailsPath}?${matchParams}`
              : detailsPath;
            return (
              <article key={snapshot.id} className="min-w-48 flex-1 space-y-2">
                <h3 className="font-semibold">
                  {product?.name ?? snapshot.name}
                </h3>
                <p>
                  {product
                    ? new Intl.NumberFormat('en-NG', {
                        style: 'currency',
                        currency,
                      }).format(product.price)
                    : 'Open product for current price'}
                </p>
                <p>
                  {matches.get(String(snapshot.id)) ||
                  snapshot.matchVariantId ||
                  snapshot.matchOfferId ||
                  snapshot.matchCondition
                    ? 'Matched option — verify on product page'
                    : (product?.condition ??
                      snapshot.condition ??
                      'Condition not refreshed')}
                </p>
                <p>Brand: {product?.brand ?? snapshot.brand ?? 'Unknown'}</p>
                <p>Category: {product?.category ?? 'Unknown'}</p>
                {rows.map((row) => (
                  <p key={row.label}>
                    {row.label}:{' '}
                    {row.values[compareItems.indexOf(snapshot)] ?? 'Unknown'}
                  </p>
                ))}
                <Link
                  className="block min-h-11 underline"
                  href={asRoute(detailsHref)}
                >
                  View details and options
                </Link>
                <button
                  type="button"
                  onClick={() => removeFromCompare(snapshot.id)}
                  className="min-h-11 text-sm"
                >
                  Remove {snapshot.name}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

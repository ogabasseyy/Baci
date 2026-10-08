'use client';
import {
  buildComparisonRows,
  normalizeCanonicalProductCondition,
} from '@baci/shared/lib';
import Link from 'next/link';
import { useState } from 'react';
import { useV2Comparison } from '@/components/storefront/ogabassey/providers/v2-comparison-context';
import type { NormalizedProduct } from '@/lib/normalize-product';
import { getProductUrl } from '@/lib/product-url';
import { asRoute } from '@/lib/routes';
import { useSearchComparisonIntent } from './search-comparison-session';
import { useSearchComparisonFacts } from './use-search-comparison-facts';
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
      // Exact-variant matches carry parent-basis specs the refresh never
      // verifies (a 128 GB match must not show the parent's 256 GB), so
      // suppress them and let the cells render Unknown, mirroring the
      // native comparison flow. Offer and base matches keep parent specs.
      // The compared basis is authoritative, matching the PDP-link logic
      // below: snapshot metadata wins, live matches serve legacy rows.
      const snapshotHasMatchMetadata = Boolean(
        snapshot.matchVariantId ||
          snapshot.matchOfferId ||
          snapshot.matchCondition
      );
      const specVariantId = snapshotHasMatchMetadata
        ? snapshot.matchVariantId
        : matches.get(String(snapshot.id))?.variantId;
      const hasVariantMatch = Boolean(specVariantId);
      return {
        id: String(snapshot.id),
        specifications: hasVariantMatch
          ? {}
          : Object.fromEntries(
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
            // Any snapshot match field (ids or condition) marks the basis
            // as authoritative: a condition-only base match must not adopt
            // a re-filtered live match's option ids. Callers treat option
            // links as exact when variant_id/offer_id are present.
            const snapshotHasMatchMetadata = Boolean(
              snapshot.matchVariantId ||
                snapshot.matchOfferId ||
                snapshot.matchCondition
            );
            const legacyLiveMatch = snapshotHasMatchMetadata
              ? undefined
              : liveMatch;
            const variantId =
              snapshot.matchVariantId ?? legacyLiveMatch?.variantId;
            const offerId = snapshot.matchOfferId ?? legacyLiveMatch?.offerId;
            // Exact IDs resolve the live option; a saved condition can change
            // independently and must not invalidate that identity on the PDP.
            const condition =
              variantId || offerId
                ? undefined
                : normalizeCanonicalProductCondition(product?.condition);
            if (variantId) matchParams.set('variant_id', variantId);
            if (condition) matchParams.set('condition', condition);
            if (offerId) matchParams.set('offer_id', offerId);
            // An ID-less match advertised the base price: mark the entry so
            // the PDP keeps it instead of resolving a same-condition offer.
            // Entries without any match context keep their bare link.
            if (
              !variantId &&
              !offerId &&
              (liveMatch || snapshot.matchCondition)
            )
              matchParams.set('match_base', '1');
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
                  {/* Parent-basis price: matched entries carry the
                      verify-on-product-page marker below; exact option
                      pricing resolves on the PDP. */}
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

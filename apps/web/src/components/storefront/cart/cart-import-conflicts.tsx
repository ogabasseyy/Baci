'use client';

import type { CartMergeResolution } from '@baci/shared/cart';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useCart } from '@/hooks/cart';

/**
 * Explicit per-line choices when a legacy device cart and the shared
 * server cart disagree on voucher or negotiated offers. Nothing merges
 * until the shopper picks an offer for every blocked line.
 */
export function CartImportConflicts() {
  const cart = useCart();
  const [picks, setPicks] = useState<CartMergeResolution[]>([]);
  const conflicts = cart.importConflicts ?? [];
  if (!cart.sharedCartEnabled || conflicts.length === 0) return null;
  const complete = conflicts.every((conflict) =>
    picks.some(
      (pick) => JSON.stringify(pick.item) === JSON.stringify(conflict.item)
    )
  );
  return (
    <section
      aria-label="Cart import choices"
      className="mx-auto max-w-xl px-4 py-6"
    >
      <h2 className="text-base font-semibold">Choose which offers to keep</h2>
      <p className="mt-2 text-sm">
        Some items in this device cart have different voucher or negotiated
        offers from your shared cart.
      </p>
      {conflicts.map((conflict) => (
        <div key={JSON.stringify(conflict.item)} className="mt-3 space-y-1">
          <p className="text-sm">Item {conflict.item.productId}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setPicks((existing) => [
                ...existing.filter(
                  (pick) =>
                    JSON.stringify(pick.item) !== JSON.stringify(conflict.item)
                ),
                { item: conflict.item, keep: 'existing' },
              ])
            }
          >
            Keep shared cart offer
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setPicks((existing) => [
                ...existing.filter(
                  (pick) =>
                    JSON.stringify(pick.item) !== JSON.stringify(conflict.item)
                ),
                { item: conflict.item, keep: 'incoming' },
              ])
            }
          >
            Keep device cart offer
          </Button>
        </div>
      ))}
      <Button
        className="mt-4"
        type="button"
        disabled={!complete}
        onClick={() => cart.resolveImportConflicts?.(picks)}
      >
        Combine with my choices
      </Button>
    </section>
  );
}

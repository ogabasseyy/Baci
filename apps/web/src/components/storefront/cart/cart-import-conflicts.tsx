'use client';

import {
  type CartMergeResolution,
  SHARED_CART_MAX_LINES,
} from '@baci/shared/cart';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useCart } from '@/hooks/cart';
import { DeviceCartCapacityItems } from './device-cart-capacity-items';

/**
 * Explicit per-line choices when a legacy device cart and the shared
 * server cart disagree on voucher or negotiated offers. Nothing merges
 * until the shopper picks an offer for every blocked line.
 */
export function CartImportConflicts() {
  const cart = useCart();
  const [picks, setPicks] = useState<CartMergeResolution[]>([]);
  const conflicts = cart.importConflicts ?? [];
  const capacityExceeded =
    cart.importWarnings?.includes('import_capacity_exceeded') ?? false;
  if (!cart.sharedCartEnabled) return null;
  if (capacityExceeded)
    return (
      <section
        aria-label="Cart import capacity"
        className="mx-auto max-w-xl px-4 py-6"
      >
        <h2 className="text-base font-semibold">
          Make room for your device cart
        </h2>
        <p role="alert" className="mt-2 text-sm">
          Combining these carts exceeds the {SHARED_CART_MAX_LINES}-line limit.
          Your device items and offers are still saved on this device.{' '}
          {!cart.sharedCartRef && cart.merchantSlug
            ? 'Remove items below, then retry importing.'
            : 'Remove items from your shared cart, then retry importing.'}
        </p>
        {!cart.sharedCartRef && cart.merchantSlug ? (
          <DeviceCartCapacityItems
            key={cart.merchantSlug}
            merchantSlug={cart.merchantSlug}
          />
        ) : null}
        <Button type="button" onClick={() => cart.resolveImportConflicts?.([])}>
          Retry importing device cart
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => cart.discardLegacyImport?.()}
        >
          {cart.sharedCartRef
            ? 'Keep shared cart and discard saved device cart'
            : 'Discard saved device cart'}
        </Button>
      </section>
    );
  if (conflicts.length === 0) return null;
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

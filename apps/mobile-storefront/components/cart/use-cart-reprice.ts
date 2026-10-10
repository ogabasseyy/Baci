import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { CHECKOUT_MERCHANT_ID } from '@/components/checkout/checkout-screen.constants';
import { useMerchant } from '@/hooks/use-merchant';
import {
  type CartPriceChange,
  pickChangedConditionById,
  pickChangedPriceById,
  repriceCartItems,
} from '@/services/cart-reprice';
import { useCartStore } from '@/stores/cart-store';
import type { CartItem } from '@/stores/cart-store.types';

function getCartRepriceKey(items: CartItem[]) {
  return items
    .map(
      (item) =>
        `${item.id}:${item.product_id}:${item.variant_id ?? ''}:${item.quantity}`
    )
    .join('|');
}

/**
 * Reconciles cart line prices against the live catalog when the cart opens.
 *
 * Best-practice pattern (commercetools "Recalculate" / Medusa refresh): the
 * persisted cart is a display cache; the live catalog is the source of truth.
 * On open we re-fetch authoritative prices, update the cart, and surface any
 * change to the shopper instead of letting it fail cryptically at checkout.
 */
export function useCartReprice() {
  const { data: merchant } = useMerchant();
  const isFocused = useIsFocused();
  const rawItems = useCartStore((state) => state.items);
  const repriceItems = useCartStore((state) => state.repriceItems);
  const [priceChanges, setPriceChanges] = useState<CartPriceChange[]>([]);
  const lastRepriceKeyRef = useRef<string | null>(null);

  // Mirror CartScreen's malformed-store recovery: if hydration produced a bad
  // shape, treat the cart as empty here rather than throwing on `items.length`
  // before the screen's recovery path can run.
  const items = Array.isArray(rawItems) ? rawItems : [];
  // `||` (not `??`) and CHECKOUT_MERCHANT_ID (not CONSTANT_MERCHANT_ID) to match
  // the checkout reprice exactly: `merchant?.id` is seeded from CONFIG.MERCHANT_ID
  // (which defaults to '') during the placeholder phase, and only
  // CHECKOUT_MERCHANT_ID carries a hardcoded UUID fallback — so this never
  // reprices against an empty merchant id.
  const merchantId = merchant?.id || CHECKOUT_MERCHANT_ID;
  const cartRepriceKey = getCartRepriceKey(items);

  useEffect(() => {
    if (
      !isFocused ||
      items.length === 0 ||
      typeof repriceItems !== 'function'
    ) {
      lastRepriceKeyRef.current = null;
      return;
    }

    const repriceKey = `${merchantId}:${cartRepriceKey}`;
    if (lastRepriceKeyRef.current === repriceKey) {
      return;
    }
    lastRepriceKeyRef.current = repriceKey;

    let cancelled = false;
    void repriceCartItems(items, merchantId)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.changes.length > 0) {
          // Apply only the reported drifts (pickChangedPriceById) so a ≤₦1
          // tolerance line in priceById can't silently clear a negotiation.
          // Drifted offer conditions refresh alongside the price so the
          // line matches what checkout will accept.
          repriceItems(
            pickChangedPriceById(result),
            pickChangedConditionById(result)
          );
          setPriceChanges(result.changes);
        }
      })
      .catch(() => {
        // Fail open: never block the cart on a pricing refresh failure.
      });

    return () => {
      cancelled = true;
    };
  }, [cartRepriceKey, isFocused, items, merchantId, repriceItems]);

  return {
    priceChanges,
    dismissPriceChanges: () => setPriceChanges([]),
  };
}

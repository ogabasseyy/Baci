'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  getCartFromStorage,
  getCartWideNegotiationFromStorage,
  saveCartToStorage,
  saveCartWideNegotiationToStorage,
} from '@/hooks/cart/cart-storage';
import type { CartItem } from '@/hooks/cart/cart-types';
import {
  displayLineMatchesAddLane,
  identityKeyOfDisplay,
} from '@/hooks/cart/shared-cart-display-identity';

/** Edit only the parked merchant-scoped device cache, before any create exists. */
export function DeviceCartCapacityItems({
  merchantSlug,
}: {
  merchantSlug: string;
}) {
  const [items, setItems] = useState<CartItem[]>([]);
  useEffect(() => {
    setItems(getCartFromStorage(merchantSlug));
  }, [merchantSlug]);
  function remove(index: number) {
    const selected = items[index];
    if (!selected) return;
    const current = getCartFromStorage(merchantSlug);
    const matchesSelected = (item: CartItem) =>
      identityKeyOfDisplay(item) === identityKeyOfDisplay(selected) &&
      item.offerId === selected.offerId &&
      displayLineMatchesAddLane(item, {
        voucherToken: selected.quizVoucherToken,
        voucherAwardId: selected.quizAwardId,
        negotiatedUnitPriceMinor:
          selected.negotiatedPrice == null
            ? undefined
            : Math.round(selected.negotiatedPrice * 100),
        negotiationStatus: selected.negotiationStatus,
      });
    const candidates = current.filter(matchesSelected);
    // A stable saved ID survives reordering and quantity edits. Without an
    // ID, remove one equivalent legacy occurrence, preserving siblings whose
    // quantity or assurance differs from the selected row.
    const target = selected.cartItemId
      ? candidates.find((item) => item.cartItemId === selected.cartItemId)
      : candidates.length === 1 &&
          items.filter(matchesSelected).length === 1 &&
          !candidates[0].cartItemId
        ? candidates[0]
        : candidates.find(
            (item) =>
              !item.cartItemId &&
              item.quantity === selected.quantity &&
              (item.hasAssurance ?? false) ===
                (selected.hasAssurance ?? false) &&
              item.assuranceRate === selected.assuranceRate
          );
    const removed = target !== undefined;
    const targetIndex = target ? current.indexOf(target) : -1;
    let remaining = removed
      ? current.filter((_, currentIndex) => currentIndex !== targetIndex)
      : current;
    if (removed && getCartWideNegotiationFromStorage(merchantSlug)) {
      remaining = remaining.map(
        ({ negotiatedPrice: _price, negotiationStatus: _status, ...item }) =>
          item
      );
      saveCartWideNegotiationToStorage(false, merchantSlug);
    }
    saveCartToStorage(remaining, merchantSlug);
    setItems(remaining);
  }
  return (
    <ul aria-label="Saved device cart items">
      {items.map((item, index) => (
        <li key={item.cartItemId ?? `${item.id}-${index}`}>
          <span>
            {item.name} {item.selectedColor} {item.selectedStorage} ×{' '}
            {item.quantity}
          </span>
          <Button type="button" variant="outline" onClick={() => remove(index)}>
            Remove {item.name}
          </Button>
        </li>
      ))}
    </ul>
  );
}

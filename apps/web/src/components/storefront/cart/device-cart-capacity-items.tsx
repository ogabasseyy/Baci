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
    const selected = JSON.stringify(items[index]);
    const current = getCartFromStorage(merchantSlug);
    let removed = false;
    let remaining = current.filter((item) => {
      if (!removed && JSON.stringify(item) === selected) {
        removed = true;
        return false;
      }
      return true;
    });
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

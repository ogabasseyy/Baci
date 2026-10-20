'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  getCartFromStorage,
  saveCartToStorage,
} from '@/hooks/cart/cart-storage';

/** Edit only the parked merchant-scoped device cache, before any create exists. */
export function DeviceCartCapacityItems({
  merchantSlug,
}: {
  merchantSlug: string;
}) {
  const [items, setItems] = useState(() => getCartFromStorage(merchantSlug));
  function remove(index: number) {
    const selected = JSON.stringify(items[index]);
    const current = getCartFromStorage(merchantSlug);
    let removed = false;
    const remaining = current.filter((item) => {
      if (!removed && JSON.stringify(item) === selected) {
        removed = true;
        return false;
      }
      return true;
    });
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

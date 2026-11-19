'use client';
import { type Dispatch, type SetStateAction, useEffect } from 'react';
import type { CartItem, SharedCartDisplayItem } from './cart-types';

/** Give old local lines an identity once they enter the local provider. */
export function useLegacyCartInstanceAdoption(
  cart: CartItem[],
  enabled: boolean,
  setCart: Dispatch<SetStateAction<CartItem[]>>
) {
  useEffect(() => {
    if (!enabled || !globalThis.crypto?.randomUUID) return;
    const identities = new Map<CartItem, string>();
    for (const item of cart) {
      if (
        item.cartLineInstanceId ||
        (item as SharedCartDisplayItem).serverLineId
      )
        continue;
      identities.set(item, globalThis.crypto.randomUUID());
    }
    if (!identities.size) return;
    setCart((previous) => {
      let changed = false;
      const next = previous.map((item) => {
        const instanceId = identities.get(item);
        if (!instanceId || item.cartLineInstanceId) return item;
        changed = true;
        return { ...item, cartLineInstanceId: instanceId };
      });
      return changed ? next : previous;
    });
  }, [cart, enabled, setCart]);
}

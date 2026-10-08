import { useState } from 'react';
import type { HandoffLine } from '../parse-handoff-lines';
import type { CartItem } from '../widget-types';

/**
 * Surfaces server cart lines the widget cannot display: another surface
 * may add products under the same token, and the authoritative merge keeps
 * those lines in the transfer URL while dropping them from the shown cart.
 * The widget cannot hydrate unknown products (no catalog lookup in the
 * bridge), so the mismatch is surfaced as a notice instead of silently
 * hiding checkout items. A clean merge clears the notice.
 */
export function useCartSyncNotice() {
  const [cartNotice, setCartNotice] = useState<string | null>(null);
  const syncCartNotice = (
    serverLines: HandoffLine[],
    localCart: CartItem[],
    excludeId: string
  ) => {
    const localIds = new Set(localCart.map((item) => item.product.id));
    const foreign = serverLines.some(
      (line) => line.product_id !== excludeId && !localIds.has(line.product_id)
    );
    setCartNotice(
      foreign
        ? 'Your guest cart includes items added in another chat. Review your cart before checkout.'
        : null
    );
  };
  return { cartNotice, syncCartNotice };
}

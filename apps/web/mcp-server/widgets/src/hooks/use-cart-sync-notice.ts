import { useState } from 'react';
import type { HandoffLine } from '../parse-handoff-lines';
import type { SkippedSurvivor } from '../recover-expired-add';
import type { CartItem } from '../widget-types';

/**
 * Explains recovery-skipped survivors: the authoritative merge drops them
 * from widget state, so without this notice adding an unrelated product
 * would make an existing item disappear without explanation. Names resolve
 * from the pre-merge cart, which still holds the skipped lines.
 */
export function describeSkippedSurvivorsNotice(
  skipped: SkippedSurvivor[],
  localCart: CartItem[]
): string | null {
  if (skipped.length === 0) return null;
  const nameOf = (productId: string) =>
    localCart.find((item) => item.product.id === productId)?.product.name ??
    'An item';
  const unavailable = skipped.filter((line) => !line.requiresVariantSelection);
  const needsOptions = skipped.filter((line) => line.requiresVariantSelection);
  const parts: string[] = [];
  if (unavailable.length === 1)
    parts.push(
      `${nameOf(unavailable[0].productId)} is no longer available and was removed from your guest cart.`
    );
  else if (unavailable.length > 1)
    parts.push(
      `${unavailable.length} items are no longer available and were removed from your guest cart.`
    );
  if (needsOptions.length === 1)
    parts.push(
      `${nameOf(needsOptions[0].productId)} now needs option selection and was removed from your guest cart; choose options on its product page to add it back.`
    );
  else if (needsOptions.length > 1)
    parts.push(
      `${needsOptions.length} items now need option selection and were removed from your guest cart; choose options on their product pages to add them back.`
    );
  return parts.join(' ');
}

/**
 * Surfaces server cart lines the widget cannot display: another surface
 * may add products under the same token, and the authoritative merge keeps
 * those lines in the transfer URL while dropping them from the shown cart.
 * The widget cannot hydrate unknown products (no catalog lookup in the
 * bridge), so the mismatch is surfaced as a notice instead of silently
 * hiding checkout items. Recovery-skipped removals ride the same channel
 * for the same reason. A clean merge clears the notice.
 */
export function useCartSyncNotice() {
  const [cartNotice, setCartNotice] = useState<string | null>(null);
  const syncCartNotice = (
    serverLines: HandoffLine[],
    localCart: CartItem[],
    excludeId: string,
    skipped: SkippedSurvivor[] = []
  ) => {
    const localIds = new Set(localCart.map((item) => item.product.id));
    const foreign = serverLines.some(
      (line) => line.product_id !== excludeId && !localIds.has(line.product_id)
    );
    const parts = [
      describeSkippedSurvivorsNotice(skipped, localCart),
      foreign
        ? 'Your guest cart includes items added in another chat. Review your cart before checkout.'
        : null,
    ].filter((part) => part !== null);
    setCartNotice(parts.length > 0 ? parts.join(' ') : null);
  };
  return { cartNotice, syncCartNotice };
}

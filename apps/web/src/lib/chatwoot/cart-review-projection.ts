import 'server-only';

import type { CartSnapshot } from '@baci/shared/cart';

/** Minimal server-owned fields suitable for an in-chat, non-payable review. */
export interface ChatwootCartReviewSnapshot {
  cartVersion: number;
  currency: string;
  estimatedTotals: boolean;
  items: Array<{
    lineId: string;
    name: string;
    productId: string;
    variantId: string | null;
    condition: string | null;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
  }>;
  itemsSubtotalMinor: number;
}

export function projectChatwootCartReview(
  cart: CartSnapshot,
  productNames: Record<string, string> | undefined
): ChatwootCartReviewSnapshot | null {
  if (
    // The shared cart command boundary caps carts at 20 lines. Refuse an
    // out-of-contract snapshot instead of truncating its canonical subtotal.
    cart.lines.length > 20 ||
    !/^[A-Z]{3}$/.test(cart.currency) ||
    !Number.isSafeInteger(cart.version) ||
    cart.version < 0 ||
    !Number.isSafeInteger(cart.subtotalMinor) ||
    cart.subtotalMinor < 0 ||
    cart.lines.reduce((sum, line) => sum + line.lineTotalMinor, 0) !==
      cart.subtotalMinor ||
    cart.lines.some((line) => !productNames?.[line.item.productId])
  ) {
    return null;
  }
  return {
    cartVersion: cart.version,
    currency: cart.currency,
    estimatedTotals: cart.estimatedTotals,
    items: cart.lines.map((line) => ({
      lineId: line.id,
      name: productNames?.[line.item.productId] ?? '',
      productId: line.item.productId,
      variantId: line.item.variantId ?? null,
      condition: line.item.condition ?? null,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.lineTotalMinor,
    })),
    itemsSubtotalMinor: cart.subtotalMinor,
  };
}

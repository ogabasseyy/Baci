import { z } from 'zod';
import { chatwootCartReviewSnapshotSchema } from '@/schemas/chatwoot-cart-review-snapshot';

export type ChatwootCartReviewSnapshot = z.infer<
  typeof chatwootCartReviewSnapshotSchema
>;

/** Build only a UI projection; browser-cart contents are never consulted. */
export function buildChatwootInlineReview(input: unknown) {
  const parsed = chatwootCartReviewSnapshotSchema.safeParse(input);
  if (!parsed.success) return null;
  try {
    const fractionDigits = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: parsed.data.currency,
    }).resolvedOptions().maximumFractionDigits;
    if (fractionDigits !== 2) return null;
  } catch {
    return null;
  }
  const { items, itemsSubtotalMinor } = parsed.data;
  const computedSubtotal = items.reduce(
    (sum, item) => sum + item.lineTotalMinor,
    0
  );
  if (
    items.length === 0 ||
    !Number.isSafeInteger(computedSubtotal) ||
    computedSubtotal !== itemsSubtotalMinor ||
    items.some(
      (item) =>
        !Number.isSafeInteger(item.unitPriceMinor * item.quantity) ||
        item.lineTotalMinor !== item.unitPriceMinor * item.quantity
    )
  ) {
    return null;
  }
  return {
    ...parsed.data,
    amountLabel: parsed.data.estimatedTotals
      ? 'Estimated items subtotal'
      : 'Items subtotal',
    disclaimer: 'Review only. Delivery and tax are not included. No order or payment has been placed.',
  };
}

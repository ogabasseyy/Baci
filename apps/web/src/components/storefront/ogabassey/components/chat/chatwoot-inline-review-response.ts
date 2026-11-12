import { buildChatwootInlineReview } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-review';

type ReviewResponse = {
  requestId: string;
  status: 'ready' | 'unavailable';
  remainingTtlMs?: number;
  cartVersion?: number;
  currency?: string;
  subtotalMinor?: number;
  items?: Array<{
    name: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
  }>;
};

export function buildChatwootInlineReviewResponse(
  requestId: string,
  snapshot: unknown,
  sessionExpiresAt: number,
  now = Date.now()
): ReviewResponse {
  const review = buildChatwootInlineReview(snapshot);
  const remainingTtlMs = Math.min(30 * 60 * 1000, sessionExpiresAt * 1000 - now);
  if (!review || review.estimatedTotals || remainingTtlMs <= 0) {
    return { requestId, status: 'unavailable' };
  }
  return {
    requestId,
    status: 'ready',
    remainingTtlMs,
    cartVersion: review.cartVersion,
    currency: review.currency,
    subtotalMinor: review.itemsSubtotalMinor,
    items: review.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      lineTotalMinor: item.lineTotalMinor,
    })),
  };
}

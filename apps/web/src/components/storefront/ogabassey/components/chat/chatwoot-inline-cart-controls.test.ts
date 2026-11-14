import { describe, expect, it, vi } from 'vitest';
import type { ChatwootCartReviewSnapshot } from './chatwoot-inline-review';
import { postChatwootCanonicalCartView } from './chatwoot-inline-cart-controls';

const snapshot: ChatwootCartReviewSnapshot = {
  cartVersion: 8,
  currency: 'NGN',
  estimatedTotals: false,
  items: [
    {
      lineId: 'server-line-1',
      name: 'Canonical Server Phone',
      productId: 'server-product-1',
      variantId: null,
      condition: null,
      quantity: 2,
      unitPriceMinor: 125000,
      lineTotalMinor: 250000,
    },
  ],
  itemsSubtotalMinor: 250000,
};

describe('Chatwoot canonical cart adapter', () => {
  it('renders server quantity and price without consulting browser cart values', () => {
    const post = vi.fn();
    const lineTokens = new Map<string, string>();
    postChatwootCanonicalCartView({
      requestId: 'request-1',
      snapshot,
      lineTokens,
      post,
    });
    const payload = JSON.parse(
      String(post.mock.calls[0]?.[0]).slice('baci-cart-view:'.length)
    );
    expect(payload.items[0]).toMatchObject({
      quantity: 2,
      unitPriceMinor: 125000,
      lineTotalMinor: 250000,
      name: 'Canonical Server Phone',
    });
    expect(payload.items[0].name).toBe('Canonical Server Phone');
    expect(payload.estimatedTotals).toBe(false);
    expect(lineTokens.get(payload.items[0].lineToken)).toBe('server-line-1');
  });
});

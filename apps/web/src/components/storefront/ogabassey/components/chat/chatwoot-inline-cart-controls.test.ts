import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatwootCartReviewSnapshot } from './chatwoot-inline-review';
import { postChatwootCanonicalCartView } from './chatwoot-inline-cart-controls';
import { handleChatwootInlineCartQuantity } from './chatwoot-inline-cart-quantity';

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
  afterEach(() => vi.unstubAllGlobals());

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

  it('refreshes after bounded token eviction instead of submitting an unknown locator', async () => {
    const lineTokens = new Map<string, string>();
    let firstToken = '';
    for (let index = 0; index < 101; index += 1) {
      const post = vi.fn();
      postChatwootCanonicalCartView({
        requestId: `cart-view-${index}`,
        snapshot,
        lineTokens,
        post,
      });
      const payload = JSON.parse(
        String(post.mock.calls[0]?.[0]).slice('baci-cart-view:'.length)
      );
      if (index === 0) firstToken = payload.items[0].lineToken;
    }
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const refreshSharedCart = vi.fn(async () => undefined);
    const postResult = vi.fn();

    await handleChatwootInlineCartQuantity({
      conversationId: 905,
      isCurrentAction: () => true,
      isCurrentCartContext: () => true,
      isCurrentContext: () => true,
      lineTokens,
      message: {
        event: 'baci-cart-quantity',
        data: {
          cartVersion: 8,
          conversationId: 905,
          expectedQuantity: 2,
          lineToken: firstToken,
          quantity: 3,
          requestId: 'quantity-0001',
          sessionToken: 'signed-session-token',
        },
      },
      post: postResult,
      refreshSharedCart,
      sessionExpiresAt: Date.now() + 60_000,
      sessionToken: 'signed-session-token',
      snapshot,
      storeSlug: 'merchant-store',
    });

    expect(lineTokens).toHaveProperty('size', 100);
    expect(lineTokens.has(firstToken)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshSharedCart).toHaveBeenCalledOnce();
    expect(postResult).toHaveBeenCalledWith({
      requestId: 'quantity-0001',
      accepted: false,
      code: 'refresh_required',
    });
  });
});

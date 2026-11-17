import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANONICAL_CART_SNAPSHOT } from '@/hooks/chatwoot-inline-cart-test-fixtures';
import { handleChatwootInlineCartQuantity } from './chatwoot-inline-cart-quantity';

vi.mock('@/lib/csrf', () => ({
  buildCsrfHeaders: vi.fn((headers) => headers),
}));

const message = {
  event: 'baci-cart-quantity' as const,
  data: {
    cartVersion: 8,
    conversationId: 905,
    expectedQuantity: 2,
    lineToken: 'opaque-line-token',
    quantity: 3,
    requestId: 'quantity-0001',
    sessionToken: 'old-session-token',
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bugfix: overlapping quantity retry sent a rotated-out capability', () => {
  it('sends the latest session token read when the POST starts', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => ({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, operationId: 'quantity-0001' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await handleChatwootInlineCartQuantity({
      conversationId: 905,
      getSessionToken: () => 'rotated-session-token',
      isCurrentAction: () => true,
      isCurrentCartContext: () => true,
      isCurrentContext: () => true,
      lineTokens: new Map([['opaque-line-token', 'server-line']]),
      message,
      post: vi.fn(),
      refreshSharedCart: vi.fn(async () => undefined),
      sessionExpiresAt: Date.now() + 60_000,
      sessionToken: 'stale-session-token',
      snapshot: CANONICAL_CART_SNAPSHOT,
      storeSlug: 'merchant-store',
    });

    const body = fetchMock.mock.calls[0]?.[1].body ?? '{}';
    expect(JSON.parse(body).sessionToken).toBe('rotated-session-token');
  });
});

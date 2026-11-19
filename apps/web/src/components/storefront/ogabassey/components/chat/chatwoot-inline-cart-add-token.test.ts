import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANONICAL_CART_SNAPSHOT } from '@/hooks/chatwoot-inline-cart-test-fixtures';
import { handleChatwootInlineCartAdd } from './chatwoot-inline-cart-add';

vi.mock('@/lib/csrf', () => ({
  buildCsrfHeaders: vi.fn((headers) => headers),
}));

afterEach(() => vi.unstubAllGlobals());

describe('bugfix: a queued add sends the capability renewed while it waited', () => {
  it('reads the latest session token when the request is sent', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => ({
        ok: true,
        status: 200,
        json: async () => ({
          accepted: true,
          cartVersion: 9,
          operationId: 'add-request-01',
        }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    let latest = 'stale-token';
    const run = handleChatwootInlineCartAdd({
      conversationId: 905,
      getSessionToken: () => latest,
      isCurrentAction: () => true,
      isCurrentCartContext: () => true,
      isCurrentContext: () => true,
      message: {
        event: 'baci-cart-add',
        data: {
          conversationId: 905,
          requestId: 'add-request-01',
          sessionToken: 'widget-token',
          slug: 'phone-13',
        },
      } as Parameters<typeof handleChatwootInlineCartAdd>[0]['message'],
      post: vi.fn(),
      sessionExpiresAt: Date.now() + 60_000,
      sessionToken: 'stale-token',
      snapshot: CANONICAL_CART_SNAPSHOT,
      storeSlug: 'merchant-store',
    });
    // An overlapping mutation renews the proof before the lock is released.
    latest = 'renewed-token';
    await run;

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.sessionToken).toBe('renewed-token');
  });
});

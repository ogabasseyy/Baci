import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({
  buildCsrfHeaders: vi.fn((headers) => headers),
}));

import {
  authorizeChatwootBridgeSession,
  isCurrentChatwootBridgeTarget,
  postChatwootBridgeJson,
} from './chatwoot-inline-bridge-transport';

const snapshot = {
  cartVersion: 8,
  currency: 'NGN',
  estimatedTotals: false,
  items: [],
  itemsSubtotalMinor: 0,
};

function response(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

function validAuthorization(overrides: Record<string, unknown> = {}) {
  return {
    authorized: true,
    conversationId: 905,
    sessionExpiresAt: Math.floor(Date.now() / 1000) + 60,
    cartSnapshot: snapshot,
    ...overrides,
  };
}

describe('Chatwoot inline bridge transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('adds the path-store merchant hint to challenge and verification routes', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => response({ requestId: 'request-1' })
    );
    vi.stubGlobal('fetch', fetchMock);

    await postChatwootBridgeJson(
      '/api/storefront/chatwoot/context/challenge',
      { requestId: 'request-1' },
      'store-a'
    );
    await postChatwootBridgeJson(
      '/api/storefront/chatwoot/context/verify',
      { challengeToken: 'challenge-1' },
      'store-a'
    );

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/storefront/chatwoot/context/challenge?merchantSlug=store-a',
      '/api/storefront/chatwoot/context/verify?merchantSlug=store-a',
    ]);
  });

  it('returns a validated server authorization and cart snapshot', async () => {
    const fetchMock = vi.fn(async () => response(validAuthorization()));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      authorizeChatwootBridgeSession('signed-session-token', 'store-a')
    ).resolves.toEqual({
      conversationId: 905,
      sessionExpiresAt: expect.any(Number),
      snapshot,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/chatwoot/context/authorize?merchantSlug=store-a',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          sessionToken: 'signed-session-token',
          includeCartSnapshot: true,
        }),
      })
    );
  });

  it.each([
    ['unsuccessful HTTP response', response(validAuthorization(), false)],
    [
      'expired session',
      response(
        validAuthorization({ sessionExpiresAt: Math.floor(Date.now() / 1000) - 1 })
      ),
    ],
    ['malformed cart snapshot', response(validAuthorization({ cartSnapshot: {} }))],
  ])('rejects an %s', async (_label, result) => {
    vi.stubGlobal('fetch', vi.fn(async () => result));

    await expect(
      authorizeChatwootBridgeSession('signed-session-token', 'store-a')
    ).resolves.toBeNull();
  });

  it('only accepts the current attached iframe, conversation and merchant target', () => {
    const holder = document.createElement('div');
    holder.id = 'cw-widget-holder';
    const frame = document.createElement('iframe');
    frame.id = 'chatwoot_live_chat_widget';
    holder.append(frame);
    document.body.append(holder);
    const target = frame.contentWindow!;
    const input = {
      active: true,
      frame,
      target,
      storeSlug: 'store-a',
      conversationId: 905,
      activeConversationId: 905,
      activeContextRequestId: 'context_123456',
      cartState: {
        isHydrated: true,
        merchantSlug: 'store-a',
        sharedCartEnabled: true,
      },
    };

    expect(isCurrentChatwootBridgeTarget(input)).toBe(true);
    expect(
      isCurrentChatwootBridgeTarget({
        ...input,
        activeConversationId: 906,
      })
    ).toBe(false);
    expect(
      isCurrentChatwootBridgeTarget({
        ...input,
        cartState: { ...input.cartState, merchantSlug: 'store-b' },
      })
    ).toBe(false);
    holder.replaceChildren(document.createElement('iframe'));
    expect(isCurrentChatwootBridgeTarget(input)).toBe(false);
  });
});

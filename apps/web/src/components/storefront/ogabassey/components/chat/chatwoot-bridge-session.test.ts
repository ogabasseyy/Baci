import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({
  buildCsrfHeaders: vi.fn((headers) => headers),
}));

import { authorizeChatwootBridgeSession } from './chatwoot-bridge-session';

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

describe('authorizeChatwootBridgeSession', () => {
  afterEach(() => vi.unstubAllGlobals());

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
    ['non-numeric conversation id', response(validAuthorization({ conversationId: '905' }))],
    ['non-numeric expiry', response(validAuthorization({ sessionExpiresAt: 'never' }))],
    ['malformed cart snapshot', response(validAuthorization({ cartSnapshot: {} }))],
  ])('rejects %s', async (_label, result) => {
    vi.stubGlobal('fetch', vi.fn(async () => result));

    await expect(
      authorizeChatwootBridgeSession('signed-session-token', 'store-a')
    ).resolves.toBeNull();
  });

  it('rejects empty or oversized session tokens before issuing a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      authorizeChatwootBridgeSession('', 'store-a')
    ).resolves.toBeNull();
    await expect(
      authorizeChatwootBridgeSession('x'.repeat(12_001), 'store-a')
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

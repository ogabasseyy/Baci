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

function input(overrides: Partial<Parameters<typeof handleChatwootInlineCartQuantity>[0]> = {}) {
  return {
    conversationId: 905,
    isCurrentAction: () => true,
    isCurrentCartContext: () => true,
    isCurrentContext: () => true,
    lineTokens: new Map([['opaque-line-token', 'server-line']]),
    message,
    post: vi.fn(),
    refreshSharedCart: vi.fn(async () => undefined),
    sessionExpiresAt: Date.now() + 60_000,
    sessionToken: 'current-session-token',
    snapshot: CANONICAL_CART_SNAPSHOT,
    storeSlug: 'merchant-store',
    ...overrides,
  };
}

function response(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('handleChatwootInlineCartQuantity', () => {
  it('sends the canonical line reference and refreshes after accepted mutation', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => response({
        accepted: true,
        cartVersion: 9,
        sessionToken: 'renewed-session-token',
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const onSessionTokenRenewed = vi.fn();
    const value = input({ onSessionTokenRenewed });

    await handleChatwootInlineCartQuantity(value);

    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      cartVersion: 8,
      conversationId: 905,
      expectedQuantity: 2,
      lineId: 'server-line',
      quantity: 3,
      requestId: 'quantity-0001',
      sessionToken: 'current-session-token',
    });
    expect(onSessionTokenRenewed).toHaveBeenCalledWith(
      'renewed-session-token'
    );
    expect(value.refreshSharedCart).toHaveBeenCalledOnce();
    expect(value.post).toHaveBeenCalledWith({
      requestId: 'quantity-0001',
      accepted: true,
      cartVersion: 9,
    });
  });

  it('refreshes an accepted commit only in the same cart after context replacement', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ accepted: true, cartVersion: 9 }))
    );
    const value = input({
      isCurrentAction: () => false,
      isCurrentContext: () => false,
      isCurrentCartContext: () => true,
    });

    await handleChatwootInlineCartQuantity(value);

    expect(value.refreshSharedCart).toHaveBeenCalledOnce();
    expect(value.post).not.toHaveBeenCalled();
  });

  it('refreshes the same cart after a transport failure with an unknown commit outcome', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    const value = input();

    await handleChatwootInlineCartQuantity(value);

    expect(value.refreshSharedCart).toHaveBeenCalledOnce();
    expect(value.post).toHaveBeenCalledWith({
      requestId: 'quantity-0001',
      accepted: false,
      code: 'temporarily_unavailable',
    });
  });

  it('does not refresh after transport failure when the cart context changed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    const value = input({ isCurrentCartContext: () => false });

    await handleChatwootInlineCartQuantity(value);

    expect(value.refreshSharedCart).not.toHaveBeenCalled();
  });

  it('refreshes after a non-JSON gateway error without retrying the mutation', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('non-json gateway response');
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const value = input();

    await handleChatwootInlineCartQuantity(value);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(value.refreshSharedCart).toHaveBeenCalledOnce();
    expect(value.post).toHaveBeenCalledWith({
      requestId: 'quantity-0001',
      accepted: false,
      code: 'temporarily_unavailable',
    });
  });

  it('surfaces refresh-required and refreshes the snapshot on conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ accepted: false, code: 'refresh_required' }, false))
    );
    const value = input();

    await handleChatwootInlineCartQuantity(value);

    expect(value.refreshSharedCart).toHaveBeenCalledOnce();
    expect(value.post).toHaveBeenCalledWith({
      requestId: 'quantity-0001',
      accepted: false,
      code: 'refresh_required',
    });
  });

  it('preserves quota errors so the bridge can back off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ accepted: false, code: 'quota_exceeded' }, false))
    );
    const value = input();

    await handleChatwootInlineCartQuantity(value);

    expect(value.refreshSharedCart).not.toHaveBeenCalled();
    expect(value.post).toHaveBeenCalledWith({
      requestId: 'quantity-0001',
      accepted: false,
      code: 'quota_exceeded',
    });
  });

  it('preserves invalid-context responses so the widget can re-authorize', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ accepted: false, code: 'invalid_context' }, false))
    );
    const value = input();

    await handleChatwootInlineCartQuantity(value);

    expect(value.refreshSharedCart).not.toHaveBeenCalled();
    expect(value.post).toHaveBeenCalledWith({
      requestId: 'quantity-0001',
      accepted: false,
      code: 'invalid_context',
    });
  });

  it('does not echo unsafe or regressing cart versions from a mutation response', async () => {
    for (const cartVersion of [1.5, Number.MAX_SAFE_INTEGER + 1, 7]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response({ accepted: true, cartVersion }))
      );
      const value = input();

      await handleChatwootInlineCartQuantity(value);

      expect(value.post).toHaveBeenCalledWith({
        requestId: 'quantity-0001',
        accepted: true,
      });
    }
  });

  it('refreshes the current snapshot on an unknown or stale local line reference', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const value = input({
      lineTokens: new Map(),
    });

    await handleChatwootInlineCartQuantity(value);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(value.post).toHaveBeenCalledWith({
      requestId: 'quantity-0001',
      accepted: false,
      code: 'refresh_required',
    });
    expect(value.refreshSharedCart).toHaveBeenCalledOnce();
  });

  it('does not refresh a superseded cart context on a stale local reference', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const value = input({
      isCurrentContext: () => false,
      lineTokens: new Map(),
    });

    await handleChatwootInlineCartQuantity(value);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(value.refreshSharedCart).not.toHaveBeenCalled();
    expect(value.post).toHaveBeenCalledWith({
      requestId: 'quantity-0001',
      accepted: false,
      code: 'refresh_required',
    });
  });
});

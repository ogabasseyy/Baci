import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANONICAL_CART_SNAPSHOT } from '@/hooks/chatwoot-inline-cart-test-fixtures';
import { handleChatwootInlineCartAdd } from './chatwoot-inline-cart-add';

vi.mock('@/lib/csrf', () => ({
  buildCsrfHeaders: vi.fn((headers) => headers),
}));

const message = {
  event: 'baci-cart-add' as const,
  data: {
    displayedPrice: 0.01,
    slug: 'phone-13',
    variantId: '00000000-0000-4000-8000-000000000003',
    requestId: 'add-request-01',
    conversationId: 905,
    sessionToken: 'widget-session-token',
  },
};

function input(overrides: Partial<Parameters<typeof handleChatwootInlineCartAdd>[0]> = {}) {
  return {
    conversationId: 905,
    isCurrentAction: () => true,
    isCurrentCartContext: () => true,
    isCurrentContext: () => true,
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

afterEach(() => vi.unstubAllGlobals());

describe('handleChatwootInlineCartAdd', () => {
  it('sends catalog identity only and refreshes after the canonical add', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      response({
        accepted: true,
        cartVersion: 9,
        operationId: 'add-request-01',
        sessionToken: 'renewed-session-token',
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const onSessionTokenRenewed = vi.fn();
    const value = input({ onSessionTokenRenewed });

    await handleChatwootInlineCartAdd(value);

    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      cartVersion: 8,
      conversationId: 905,
      productSlug: 'phone-13',
      requestId: 'add-request-01',
      sessionToken: 'current-session-token',
      variantId: '00000000-0000-4000-8000-000000000003',
    });
    expect(JSON.stringify(init?.body)).not.toContain('displayedPrice');
    expect(JSON.stringify(init?.body)).not.toContain('0.01');
    expect(onSessionTokenRenewed).toHaveBeenCalledWith('renewed-session-token');
    expect(value.refreshSharedCart).toHaveBeenCalledOnce();
    expect(value.post).toHaveBeenCalledWith({
      requestId: 'add-request-01',
      accepted: true,
      cartVersion: 9,
    });
  });

  it('rejects an expired context before sending product authority', async () => {
    const fetchMock = vi.fn(async () => response({ accepted: false }));
    vi.stubGlobal('fetch', fetchMock);
    const value = input({ sessionExpiresAt: Date.now() - 1 });

    await handleChatwootInlineCartAdd(value);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(value.post).toHaveBeenCalledWith({
      requestId: 'add-request-01',
      accepted: false,
      code: 'invalid_context',
    });
  });

  it('posts the server result when the session expires during the request', async () => {
    const value = input();
    value.isCurrentContext = () => value.sessionExpiresAt > Date.now();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        value.sessionExpiresAt = Date.now() - 1;
        return response({
          accepted: true,
          cartVersion: 9,
          operationId: 'add-request-01',
          sessionToken: 'renewed-session-token',
        });
      })
    );
    const onSessionTokenRenewed = vi.fn();
    value.onSessionTokenRenewed = onSessionTokenRenewed;

    await handleChatwootInlineCartAdd(value);

    expect(onSessionTokenRenewed).not.toHaveBeenCalled();
    expect(value.post).toHaveBeenCalledWith({
      requestId: 'add-request-01',
      accepted: true,
      cartVersion: 9,
    });
  });

  it.each([Number.MAX_SAFE_INTEGER + 1, 7])(
    'does not forward unsafe or stale cart version %s',
    async (cartVersion) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          response({
            accepted: true,
            cartVersion,
            operationId: 'add-request-01',
          })
        )
      );
      const value = input();

      await handleChatwootInlineCartAdd(value);

      expect(value.post).toHaveBeenCalledWith({
        requestId: 'add-request-01',
        accepted: true,
      });
    }
  );

  it('does not refresh the cart for a deterministic unavailable item', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({ accepted: false, code: 'not_addable' }),
      }))
    );
    const value = input();

    await handleChatwootInlineCartAdd(value);

    expect(value.refreshSharedCart).not.toHaveBeenCalled();
    expect(value.post).toHaveBeenCalledWith({
      requestId: 'add-request-01',
      accepted: false,
      code: 'not_addable',
    });
  });

  it('refreshes the cart and reports stale state on a version conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ accepted: false, code: 'refresh_required' }, false))
    );
    const value = input();

    await handleChatwootInlineCartAdd(value);

    expect(value.refreshSharedCart).toHaveBeenCalledOnce();
    expect(value.post).toHaveBeenCalledWith({
      requestId: 'add-request-01',
      accepted: false,
      code: 'refresh_required',
    });
  });

  it('refreshes the cart when an idempotency conflict may hide a prior add', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({ accepted: false, code: 'idempotency_conflict' }, false)
      )
    );
    const value = input();

    await handleChatwootInlineCartAdd(value);

    expect(value.refreshSharedCart).toHaveBeenCalledOnce();
    expect(value.post).toHaveBeenCalledWith({
      requestId: 'add-request-01',
      accepted: false,
      code: 'idempotency_conflict',
    });
  });
});

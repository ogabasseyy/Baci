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

function input() {
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
  };
}

function stubResponse(body: unknown, status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status, json: async () => body }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quantity mutation behind a JSON gateway failure', () => {
  it('reconciles the shared cart when the commit outcome is unknown', async () => {
    stubResponse({ error: 'Bad Gateway' }, 502);
    const args = input();

    await handleChatwootInlineCartQuantity(args);

    expect(args.refreshSharedCart).toHaveBeenCalledOnce();
    expect(args.post).toHaveBeenCalledWith({
      requestId: 'quantity-0001',
      accepted: false,
      code: 'temporarily_unavailable',
    });
  });

  it.each([
    ['forbidden', 403],
    ['invalid_context', 403],
    ['quota_exceeded', 429],
  ])('does not reconcile a definitive %s rejection', async (code, status) => {
    stubResponse({ accepted: false, code }, status);
    const args = input();

    await handleChatwootInlineCartQuantity(args);

    expect(args.refreshSharedCart).not.toHaveBeenCalled();
    expect(args.post).toHaveBeenCalledWith({
      requestId: 'quantity-0001',
      accepted: false,
      code,
    });
  });

  it('refreshes once for a refresh_required rejection', async () => {
    stubResponse({ accepted: false, code: 'refresh_required' }, 409);
    const args = input();

    await handleChatwootInlineCartQuantity(args);

    expect(args.refreshSharedCart).toHaveBeenCalledOnce();
  });
});

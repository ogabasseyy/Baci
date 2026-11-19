import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_CART_SNAPSHOT,
  CHATWOOT_WIDGET_ORIGIN,
  challengeResponse,
  contextResponse,
  establishChatwootWidgetContext,
  installChatwootFrame,
  sendChatwootWidgetMessage,
} from './chatwoot-inline-cart-test-fixtures';

const mocks = vi.hoisted(() => ({
  cartState: {
    addToCart: vi.fn(),
    cart: [],
    ensureSharedCartSession: vi.fn(async () => ({ ok: true as const })),
    isHydrated: true,
    merchantSlug: 'store',
    sharedCartEnabled: true,
    sharedCartRef: { cartId: 'cart-1', version: 8 },
    syncStatus: 'synced',
    updateQuantity: vi.fn(),
  },
  buildCsrfHeaders: vi.fn((headers) => headers),
}));

vi.mock('@/hooks/cart', () => ({ useCart: () => mocks.cartState }));
vi.mock('@/lib/csrf', () => ({ buildCsrfHeaders: mocks.buildCsrfHeaders }));

import { useChatwootInlineCartBridge } from './use-chatwoot-inline-cart-bridge';

function HookHarness() {
  useChatwootInlineCartBridge('store', CHATWOOT_WIDGET_ORIGIN);
  return null;
}

const authorized = (sessionToken: string) => ({
  ok: true,
  json: async () => ({
    authorized: true,
    cartId: 'cart-1',
    conversationId: 905,
    sessionExpiresAt: Math.floor(Date.now() / 1000) + 300,
    sessionToken,
    cartSnapshot: CANONICAL_CART_SNAPSHOT,
  }),
});

describe('bugfix: a slow product authorize cannot roll back a renewed proof', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('keeps the proof renewed by a cart mutation when an older authorize resolves late', async () => {
    const { target, postMessage } = installChatwootFrame();
    const authorizeBodies: Record<string, unknown>[] = [];
    let releaseProduct: () => void = () => undefined;
    const productGate = new Promise<void>((resolve) => {
      releaseProduct = resolve;
    });
    let authorizeCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const route = new URL(path, 'https://store.test').pathname;
        if (route.endsWith('/challenge')) {
          return challengeResponse(String(body.requestId));
        }
        if (route.endsWith('/verify')) {
          return contextResponse(String(body.contextToken));
        }
        if (route.endsWith('/authorize')) {
          authorizeBodies.push(body);
          authorizeCount += 1;
          // #1 initial cart view, #2 slow product lookup, #3 quantity, #4 review.
          if (authorizeCount === 2) {
            await productGate;
            return authorized('stale-from-product');
          }
          return authorized(`auth-${authorizeCount}`);
        }
        if (route.endsWith('/quantity')) {
          return {
            ok: true,
            json: async () => ({
              accepted: true,
              cartVersion: 9,
              operationId: String(body.requestId),
              sessionToken: 'renewed-by-quantity',
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      })
    );
    render(<HookHarness />);
    const base = { conversationId: 905, sessionToken: 'session-905' };

    await act(async () => {
      await establishChatwootWidgetContext(target, postMessage);
      sendChatwootWidgetMessage(target, 'baci-cart-request', {
        ...base,
        requestId: 'cart-initial',
      });
      await waitFor(() =>
        expect(
          postMessage.mock.calls.some(([p]) =>
            String(p).startsWith('baci-cart-view:')
          )
        ).toBe(true)
      );
    });
    const view = postMessage.mock.calls
      .map(([p]) => String(p))
      .find((p) => p.startsWith('baci-cart-view:'));
    const lineToken = JSON.parse(String(view).slice('baci-cart-view:'.length))
      .items[0]?.lineToken;

    await act(async () => {
      sendChatwootWidgetMessage(target, 'baci-product-request', {
        ...base,
        requestId: 'product-0001',
        slug: 'phone-15',
      });
      await waitFor(() => expect(authorizeBodies).toHaveLength(2));
      sendChatwootWidgetMessage(target, 'baci-cart-quantity', {
        ...base,
        requestId: 'quantity-0001',
        cartVersion: 8,
        expectedQuantity: 2,
        quantity: 3,
        lineToken,
      });
      await waitFor(() => expect(authorizeBodies).toHaveLength(3));
      await waitFor(() =>
        expect(
          postMessage.mock.calls.some(([p]) =>
            String(p).startsWith('baci-cart-quantity-result:')
          )
        ).toBe(true)
      );
      releaseProduct();
      await waitFor(() =>
        expect(
          postMessage.mock.calls.some(([p]) =>
            String(p).startsWith('baci-product-response:')
          )
        ).toBe(true)
      );
      sendChatwootWidgetMessage(target, 'baci-checkout-review-request', {
        ...base,
        requestId: 'review-after-race',
      });
      await waitFor(() => expect(authorizeBodies).toHaveLength(4));
    });

    expect(authorizeBodies[3]?.sessionToken).toBe('renewed-by-quantity');
  });
});

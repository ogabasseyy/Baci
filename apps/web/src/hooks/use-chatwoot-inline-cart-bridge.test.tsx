import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_CART_SNAPSHOT as canonicalSnapshot,
  challengeResponse,
  contextResponse,
  establishChatwootWidgetContext as establishWidgetContext,
  installChatwootFrame as installFrame,
  CHATWOOT_WIDGET_ORIGIN as origin,
  authorizedCartResponse as response,
  sendChatwootWidgetMessage as sendWidgetMessage,
} from './chatwoot-inline-cart-test-fixtures';

const mocks = vi.hoisted(() => ({
  cartState: {
    addToCart: vi.fn(),
    cart: [
      {
        id: 'local-product',
        name: 'Forged local name',
        price: 1,
        quantity: 99,
        cartItemId: 'local-line',
        serverLineId: 'server-line',
      },
    ],
    isHydrated: true,
    merchantSlug: 'store',
    refreshSharedCart: vi.fn(async () => {}),
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

function HookHarness({
  storeSlug,
  widgetOrigin,
}: {
  storeSlug: string;
  widgetOrigin: string;
}) {
  useChatwootInlineCartBridge(storeSlug, widgetOrigin);
  return null;
}

describe('ChatwootInlineCartBridge', () => {
  it('posts context authorization only to the configured widget origin', async () => {
    const { target, postMessage } = installFrame();
    render(<HookHarness storeSlug="store" widgetOrigin={origin} />);

    await act(async () => {
      await establishWidgetContext(target, postMessage);
    });

    const authorizationPosts = postMessage.mock.calls.filter(([payload]) =>
      String(payload).startsWith('baci-commerce-context-authorized:')
    );
    expect(authorizationPosts).toHaveLength(1);
    expect(authorizationPosts[0]?.[1]).toBe(origin);
  });

  it.each([
    ['empty challenge token', true],
    ['empty session token', false],
  ])('denies an %s from the context service', async (_label, emptyChallenge) => {
    const fetchMock = vi.fn(async (path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const route = new URL(path, 'https://store.test').pathname;
      if (route.endsWith('/challenge')) {
        return challengeResponse(
          String(body.requestId),
          emptyChallenge ? '' : undefined
        );
      }
      return contextResponse(
        String(body.contextToken),
        emptyChallenge ? undefined : ''
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const { target, postMessage } = installFrame();
    render(<HookHarness storeSlug="store" widgetOrigin={origin} />);

    sendWidgetMessage(target, 'baci-commerce-context-request', {
      requestId: 'context_123456',
      conversationId: 905,
      websiteToken: 'synthetic-widget-token-123456',
      visitorTokenSha256: 'b'.repeat(64),
    });
    await waitFor(() =>
      expect(
        postMessage.mock.calls.some(([payload]) =>
          String(payload).startsWith('baci-commerce-context-challenge:')
        )
      ).toBe(!emptyChallenge)
    );
    if (emptyChallenge) {
      await waitFor(() =>
        expect(
          postMessage.mock.calls.some(([payload]) =>
            String(payload).startsWith('baci-commerce-context-denied:')
          )
        ).toBe(true)
      );
      return;
    }

    sendWidgetMessage(target, 'baci-commerce-context-ready', {
      requestId: 'context_123456',
      conversationId: 905,
      contextToken: 'context-905',
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });
    await waitFor(() =>
      expect(
        postMessage.mock.calls.some(([payload]) =>
          String(payload).startsWith('baci-commerce-context-denied:')
        )
      ).toBe(true)
    );
    expect(
      fetchMock.mock.calls.some(([path]) =>
        new URL(String(path), 'https://store.test').pathname.endsWith('/verify')
      )
    ).toBe(true);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.cartState.merchantSlug = 'store';
    mocks.cartState.sharedCartRef = { cartId: 'cart-1', version: 8 };
    mocks.cartState.syncStatus = 'synced';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (
          new URL(path, 'https://store.test').pathname.endsWith('/challenge')
        ) {
          return challengeResponse(String(body.requestId));
        }
        if (new URL(path, 'https://store.test').pathname.endsWith('/verify')) {
          return contextResponse(String(body.contextToken));
        }
        if (
          new URL(path, 'https://store.test').pathname.endsWith('/quantity')
        ) {
          return {
            ok: true,
            json: async () => ({ accepted: true, cartVersion: 9 }),
          };
        }
        const conversationId = Number(
          String(body.sessionToken).split('-').at(-1)
        );
        return response(conversationId);
      })
    );
  });

  it('fails closed instead of presenting an estimated subtotal as exact', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (
          new URL(path, 'https://store.test').pathname.endsWith('/challenge')
        ) {
          return challengeResponse(String(body.requestId));
        }
        if (new URL(path, 'https://store.test').pathname.endsWith('/verify')) {
          return contextResponse(String(body.contextToken));
        }
        return response(905, {
          ...canonicalSnapshot,
          estimatedTotals: true,
        });
      })
    );
    const { target, postMessage } = installFrame();
    render(<HookHarness storeSlug="store" widgetOrigin={origin} />);
    await act(async () => {
      await establishWidgetContext(target, postMessage);
      postMessage.mockClear();
      sendWidgetMessage(target, 'baci-checkout-review-request', {
        requestId: 'review-0004',
        conversationId: 905,
        sessionToken: 'session-905',
      });
      await waitFor(() =>
        expect(
          postMessage.mock.calls.some(([payload]) =>
            String(payload).startsWith('baci-checkout-review:')
          )
        ).toBe(true)
      );
    });
    const payload = String(postMessage.mock.calls.at(-1)?.[0]);
    expect(JSON.parse(payload.slice('baci-checkout-review:'.length))).toEqual({
      requestId: 'review-0004',
      status: 'unavailable',
    });
  });
});

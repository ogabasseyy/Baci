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

  it('rejects quantity changes until a durable shared-cart receipt exists', async () => {
    const { target, postMessage } = installFrame();
    render(<HookHarness storeSlug="store" widgetOrigin={origin} />);
    await act(async () => {
      await establishWidgetContext(target, postMessage);
      sendWidgetMessage(target, 'baci-cart-request', {
        requestId: 'cart-0001',
        conversationId: 905,
        sessionToken: 'session-905',
      });
      await waitFor(() =>
        expect(
          postMessage.mock.calls.some(([payload]) =>
            String(payload).startsWith('baci-cart-view:')
          )
        ).toBe(true)
      );
    });
    const cartPayload = String(postMessage.mock.calls.at(-1)?.[0]);
    const cart = JSON.parse(cartPayload.slice('baci-cart-view:'.length));
    const item = cart.items[0];

    await act(async () => {
      sendWidgetMessage(target, 'baci-cart-quantity', {
        requestId: 'quantity-0001',
        lineToken: item.lineToken,
        expectedQuantity: item.quantity,
        quantity: item.quantity + 1,
        conversationId: 905,
        sessionToken: 'session-905',
      });
      await waitFor(() =>
        expect(
          postMessage.mock.calls.some(([payload]) =>
            String(payload).startsWith('baci-cart-quantity-result:')
          )
        ).toBe(true)
      );
    });

    const quantityPayload = String(postMessage.mock.calls.at(-1)?.[0]);
    expect(quantityPayload.startsWith('baci-cart-quantity-result:')).toBe(true);
    expect(
      JSON.parse(quantityPayload.slice('baci-cart-quantity-result:'.length))
    ).toEqual({ requestId: 'quantity-0001', accepted: false });
    expect(mocks.cartState.updateQuantity).not.toHaveBeenCalled();
  });

  it('requests delivery estimates with the bound session, state, and server cart version', async () => {
    const deliveryEstimate = {
      state: 'Lagos',
      cartVersion: canonicalSnapshot.cartVersion,
      currency: canonicalSnapshot.currency,
      subtotalMinor: canonicalSnapshot.itemsSubtotalMinor,
      options: [
        {
          displayName: 'Merchant delivery',
          priceMajor: 2500,
          currency: 'NGN',
          estimatedDays: 2,
          pickup: false,
        },
      ],
    };
    const fetchMock = vi.fn(async (path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const route = new URL(path, 'https://store.test').pathname;
      if (route.endsWith('/challenge')) {
        return challengeResponse(String(body.requestId));
      }
      if (route.endsWith('/verify')) {
        return contextResponse(String(body.contextToken));
      }
      if (route.endsWith('/delivery-options')) {
        return { ok: true, json: async () => deliveryEstimate };
      }
      return response(905);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { target, postMessage } = installFrame();
    render(<HookHarness storeSlug="store" widgetOrigin={origin} />);

    await act(async () => {
      await establishWidgetContext(target, postMessage);
      sendWidgetMessage(target, 'baci-cart-request', {
        requestId: 'cart-0002',
        conversationId: 905,
        sessionToken: 'session-905',
      });
      await waitFor(() =>
        expect(
          postMessage.mock.calls.some(([payload]) =>
            String(payload).startsWith('baci-cart-view:')
          )
        ).toBe(true)
      );
      sendWidgetMessage(target, 'baci-delivery-options-request', {
        requestId: 'delivery-0001',
        conversationId: 905,
        sessionToken: 'session-905',
        state: 'Lagos',
      });
      await waitFor(() =>
        expect(
          postMessage.mock.calls.some(([payload]) =>
            String(payload).startsWith('baci-delivery-options-result:')
          )
        ).toBe(true)
      );
    });

    const deliveryCall = fetchMock.mock.calls.find(([path]) =>
      new URL(String(path), 'https://store.test').pathname.endsWith(
        '/delivery-options'
      )
    );
    expect(deliveryCall).toBeDefined();
    expect(JSON.parse(String(deliveryCall?.[1].body))).toEqual({
      sessionToken: 'session-905',
      conversationId: 905,
      expectedCartVersion: canonicalSnapshot.cartVersion,
      state: 'Lagos',
    });

    const resultPayload = String(
      postMessage.mock.calls.find(([payload]) =>
        String(payload).startsWith('baci-delivery-options-result:')
      )?.[0]
    );
    expect(
      JSON.parse(resultPayload.slice('baci-delivery-options-result:'.length))
    ).toEqual({
      requestId: 'delivery-0001',
      status: 'ready',
      ...deliveryEstimate,
    });
  });
});

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
            json: async () => ({
              accepted: true,
              cartVersion: 9,
              operationId: body.requestId,
            }),
          };
        }
        const conversationId = Number(
          String(body.sessionToken).split('-').at(-1)
        );
        return response(conversationId);
      })
    );
  });

  it('consumes product requests and returns a canonical product response', async () => {
    const product = {
      availability: 'in_stock',
      condition: 'new',
      currency: 'NGN',
      image: 'https://cdn.example.test/phone.jpg',
      name: 'Phone 15',
      price: 300_000,
      slug: 'phone-15',
      variants: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const pathname = new URL(path, 'https://store.test').pathname;
        if (pathname.endsWith('/challenge')) {
          return challengeResponse(String(body.requestId));
        }
        if (pathname.endsWith('/verify')) {
          return contextResponse(String(body.contextToken));
        }
        if (pathname.endsWith('/products')) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              product,
              requestId: body.requestId,
            }),
          };
        }
        return response(905);
      })
    );
    const { target, postMessage } = installFrame();
    render(<HookHarness storeSlug="store" widgetOrigin={origin} />);

    await act(async () => {
      await establishWidgetContext(target, postMessage);
      postMessage.mockClear();
      sendWidgetMessage(target, 'baci-product-request', {
        requestId: 'product-0001',
        conversationId: 905,
        sessionToken: 'session-905',
        slug: 'phone-15',
      });
      await waitFor(() =>
        expect(
          postMessage.mock.calls.some(([payload]) =>
            String(payload).startsWith('baci-product-response:')
          )
        ).toBe(true)
      );
    });

    const payload = String(postMessage.mock.calls.at(-1)?.[0]);
    expect(JSON.parse(payload.slice('baci-product-response:'.length))).toEqual({
      requestId: 'product-0001',
      status: 'available',
      product,
    });
  });

  it('uses a canonical card variant in the Baci cart-add request', async () => {
    const variantId = '33333333-3333-4333-8333-333333333333';
    const product = {
      availability: 'in_stock',
      currency: 'NGN',
      name: 'Phone 15',
      price: 325_000,
      slug: 'phone-15',
      variants: [
        {
          id: variantId,
          attributes: { storage: '128GB', 'sim type': 'Physical + eSIM' },
          price: 325_000,
          availability: 'in_stock',
          condition: 'new',
        },
      ],
    };
    const fetchMock = vi.fn(async (path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const pathname = new URL(path, 'https://store.test').pathname;
      if (pathname.endsWith('/challenge')) {
        return challengeResponse(String(body.requestId));
      }
      if (pathname.endsWith('/verify')) {
        return contextResponse(String(body.contextToken));
      }
      if (pathname.endsWith('/products')) {
        return {
          ok: true,
          json: async () => ({ ok: true, product, requestId: body.requestId }),
        };
      }
      if (pathname.endsWith('/cart/add')) {
        return {
          ok: true,
          json: async () => ({
            accepted: true,
            operationId: body.requestId,
            cartVersion: 9,
          }),
        };
      }
      return response(905);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { target, postMessage } = installFrame();
    render(<HookHarness storeSlug="store" widgetOrigin={origin} />);

    await act(async () => {
      await establishWidgetContext(target, postMessage);
      postMessage.mockClear();
      sendWidgetMessage(target, 'baci-product-request', {
        requestId: 'product-card-01',
        conversationId: 905,
        sessionToken: 'session-905',
        slug: 'phone-15',
      });
      await waitFor(() =>
        expect(
          postMessage.mock.calls.some(([payload]) =>
            String(payload).startsWith('baci-product-response:')
          )
        ).toBe(true)
      );

      const productResponse = JSON.parse(
        String(postMessage.mock.calls.at(-1)?.[0]).slice(
          'baci-product-response:'.length
        )
      ) as { product: typeof product };
      const selectedVariant = productResponse.product.variants[0];
      expect(selectedVariant).toMatchObject({ id: variantId, price: 325_000 });

      postMessage.mockClear();
      sendWidgetMessage(target, 'baci-cart-add', {
        requestId: 'cart-add-0001',
        conversationId: 905,
        sessionToken: 'session-905',
        slug: productResponse.product.slug,
        variantId: selectedVariant.id,
        displayedPrice: selectedVariant.price,
      });
      await waitFor(() =>
        expect(
          postMessage.mock.calls.some(([payload]) =>
            String(payload).startsWith('baci-cart-add-result:')
          )
        ).toBe(true)
      );
    });

    const addCall = fetchMock.mock.calls.find(([path]) =>
      new URL(path, 'https://store.test').pathname.endsWith('/cart/add')
    );
    expect(addCall).toBeDefined();
    const addBody = JSON.parse(String(addCall?.[1].body));
    expect(addBody).toMatchObject({
      conversationId: 905,
      productSlug: 'phone-15',
      requestId: 'cart-add-0001',
      sessionToken: 'session-905',
      variantId,
    });
    expect(addBody).not.toHaveProperty('displayedPrice');
    expect(
      JSON.parse(
        String(postMessage.mock.calls.at(-1)?.[0]).slice(
          'baci-cart-add-result:'.length
        )
      )
    ).toMatchObject({ accepted: true, requestId: 'cart-add-0001' });
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

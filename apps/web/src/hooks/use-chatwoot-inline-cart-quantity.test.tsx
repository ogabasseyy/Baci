import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authorizedCartResponse,
  CHATWOOT_WIDGET_ORIGIN,
  challengeResponse,
  contextResponse,
  establishChatwootWidgetContext,
  installChatwootFrame,
  sendChatwootWidgetMessage,
} from './chatwoot-inline-cart-test-fixtures';

const mocks = vi.hoisted(() => ({
  cartState: {
    isHydrated: true,
    merchantSlug: 'store',
    refreshSharedCart: vi.fn(async () => {}),
    sharedCartEnabled: true,
    sharedCartRef: { cartId: 'cart-1', version: 8 },
  },
  buildCsrfHeaders: vi.fn((headers) => headers),
}));

vi.mock('@/hooks/cart', () => ({ useCart: () => mocks.cartState }));
vi.mock('@/lib/csrf', () => ({ buildCsrfHeaders: mocks.buildCsrfHeaders }));

import { useChatwootInlineCartBridge } from './use-chatwoot-inline-cart-bridge';

function Harness() {
  useChatwootInlineCartBridge('store', CHATWOOT_WIDGET_ORIGIN);
  return null;
}

function defaultFetch() {
  return vi.fn(async (path: string, init: RequestInit) => {
    const url = new URL(path, 'https://store.test');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    if (url.pathname.endsWith('/challenge')) {
      return challengeResponse(String(body.requestId));
    }
    if (url.pathname.endsWith('/verify')) {
      return contextResponse(String(body.contextToken));
    }
    if (url.pathname.endsWith('/quantity')) {
      return {
        ok: true,
        json: async () => ({
          accepted: true,
          cartVersion: 9,
          operationId: body.requestId,
        }),
      };
    }
    return authorizedCartResponse(905);
  });
}

async function mountWithCartView() {
  const { target, postMessage } = installChatwootFrame();
  render(<Harness />);
  await act(async () => {
    await establishChatwootWidgetContext(target, postMessage);
    sendChatwootWidgetMessage(target, 'baci-cart-request', {
      requestId: 'cart-request-01',
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
  const cart = JSON.parse(
    String(postMessage.mock.calls.at(-1)?.[0]).slice('baci-cart-view:'.length)
  );
  return { cart, postMessage, target };
}

describe('Chatwoot inline cart quantity mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.cartState.merchantSlug = 'store';
    mocks.cartState.sharedCartRef = { cartId: 'cart-1', version: 8 };
    vi.stubGlobal('fetch', defaultFetch());
  });

  it('submits a canonical line/version and refreshes the shared cart after acceptance', async () => {
    const { cart, postMessage, target } = await mountWithCartView();
    const item = cart.items[0];

    await act(async () => {
      sendChatwootWidgetMessage(target, 'baci-cart-quantity', {
        requestId: 'quantity-0001',
        lineToken: item.lineToken,
        cartVersion: cart.cartVersion,
        expectedQuantity: item.quantity,
        quantity: item.quantity + 1,
        conversationId: 905,
        sessionToken: 'session-905',
      });
      await waitFor(() =>
        expect(
          postMessage.mock.calls.some(([payload]) => {
            const raw = String(payload);
            return (
              raw.startsWith('baci-cart-quantity-result:') &&
              JSON.parse(raw.slice('baci-cart-quantity-result:'.length))
                .accepted === true
            );
          })
        ).toBe(true)
      );
    });

    const request = vi
      .mocked(fetch)
      .mock.calls.map(([path, init]) => ({
        path: String(path),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      }))
      .find(({ path }) => path.includes('/cart/quantity'));
    expect(request?.body).toMatchObject({
      cartVersion: 8,
      conversationId: 905,
      expectedQuantity: 2,
      lineId: 'server-line',
      quantity: 3,
      requestId: 'quantity-0001',
      sessionToken: 'session-905',
    });
    expect(mocks.cartState.refreshSharedCart).toHaveBeenCalledOnce();
  });

  it('returns a bounded failure result when session authorization cannot be refreshed', async () => {
    let authorizeCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init: RequestInit) => {
        const url = new URL(path, 'https://store.test');
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (url.pathname.endsWith('/challenge')) {
          return challengeResponse(String(body.requestId));
        }
        if (url.pathname.endsWith('/verify')) {
          return contextResponse(String(body.contextToken));
        }
        authorizeCalls += 1;
        return authorizeCalls === 1
          ? authorizedCartResponse(905)
          : { ok: false, json: async () => ({}) };
      })
    );
    const { cart, postMessage, target } = await mountWithCartView();
    const item = cart.items[0];

    await act(async () => {
      sendChatwootWidgetMessage(target, 'baci-cart-quantity', {
        requestId: 'quantity-auth-failed',
        lineToken: item.lineToken,
        cartVersion: cart.cartVersion,
        expectedQuantity: item.quantity,
        quantity: item.quantity + 1,
        conversationId: 905,
        sessionToken: 'session-905',
      });
      await waitFor(() =>
        expect(
          postMessage.mock.calls.some(([payload]) => {
            const raw = String(payload);
            return (
              raw.startsWith('baci-cart-quantity-result:') &&
              JSON.parse(raw.slice('baci-cart-quantity-result:'.length))
                .requestId === 'quantity-auth-failed'
            );
          })
        ).toBe(true)
      );
    });

    expect(
      postMessage.mock.calls
        .map(([payload]) => String(payload))
        .find((raw) => raw.startsWith('baci-cart-quantity-result:'))
    ).toContain('"accepted":false');
    expect(mocks.cartState.refreshSharedCart).not.toHaveBeenCalled();
  });

  it('reconciles the same-cart commit but suppresses its stale reply after context change', async () => {
    let finishMutation:
      | ((response: {
          ok: true;
          json: () => Promise<Record<string, unknown>>;
        }) => void)
      | null = null;
    let mutationStarted = false;
    let mutationCompleted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init: RequestInit) => {
        const url = new URL(path, 'https://store.test');
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (url.pathname.endsWith('/challenge')) {
          return Promise.resolve(challengeResponse(String(body.requestId)));
        }
        if (url.pathname.endsWith('/verify')) {
          return Promise.resolve(contextResponse(String(body.contextToken)));
        }
        if (url.pathname.endsWith('/quantity')) {
          mutationStarted = true;
          return new Promise((resolve) => {
            finishMutation = resolve as typeof finishMutation;
          });
        }
        return Promise.resolve(authorizedCartResponse(905));
      })
    );
    const { cart, postMessage, target } = await mountWithCartView();
    const item = cart.items[0];

    await act(async () => {
      sendChatwootWidgetMessage(target, 'baci-cart-quantity', {
        requestId: 'quantity-invalidated',
        lineToken: item.lineToken,
        cartVersion: cart.cartVersion,
        expectedQuantity: item.quantity,
        quantity: item.quantity + 1,
        conversationId: 905,
        sessionToken: 'session-905',
      });
      await waitFor(() => expect(mutationStarted).toBe(true));
    });

    postMessage.mockClear();
    await act(async () => {
      sendChatwootWidgetMessage(target, 'baci-commerce-context-request', {
        requestId: 'context_654321',
        conversationId: 905,
        websiteToken: 'synthetic-widget-token-123456',
        visitorTokenSha256: 'b'.repeat(64),
      });
      finishMutation?.({
        ok: true,
        json: async () => {
          mutationCompleted = true;
          return {
            accepted: true,
            cartVersion: 9,
            operationId: 'quantity-invalidated',
          };
        },
      });
      await waitFor(() => expect(mutationCompleted).toBe(true));
    });

    expect(
      postMessage.mock.calls.some(([payload]) =>
        String(payload).startsWith('baci-cart-quantity-result:')
      )
    ).toBe(false);
    expect(mocks.cartState.refreshSharedCart).toHaveBeenCalledOnce();
  });
});

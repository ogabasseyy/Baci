import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authorizedCartResponse,
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

  it('retries the exact operation after a lost acknowledgement at a newer cart version', async () => {
    let authorizeCalls = 0;
    const quantityBodies: Record<string, unknown>[] = [];
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
        if (url.pathname.endsWith('/quantity')) {
          quantityBodies.push(body);
          return quantityBodies.length === 1
            ? { ok: false, json: async () => ({}) }
            : {
                ok: true,
                json: async () => ({
                  accepted: true,
                  cartVersion: 9,
                  operationId: body.requestId,
                }),
              };
        }
        authorizeCalls += 1;
        const snapshot =
          authorizeCalls > 1
            ? {
                ...CANONICAL_CART_SNAPSHOT,
                cartVersion: 9,
                items: CANONICAL_CART_SNAPSHOT.items.map((line) => ({
                  ...line,
                  quantity: 3,
                  lineTotalMinor: line.unitPriceMinor * 3,
                })),
              }
            : CANONICAL_CART_SNAPSHOT;
        return authorizedCartResponse(905, snapshot);
      })
    );
    const { cart, postMessage, target } = await mountWithCartView();
    const item = cart.items[0];
    const request = {
      requestId: 'quantity-replay-01',
      lineToken: item.lineToken,
      cartVersion: cart.cartVersion,
      expectedQuantity: item.quantity,
      quantity: item.quantity + 1,
      conversationId: 905,
      sessionToken: 'session-905',
    };

    await act(async () => {
      sendChatwootWidgetMessage(target, 'baci-cart-quantity', request);
      await waitFor(() => expect(quantityBodies).toHaveLength(1));
      await waitFor(() =>
        expect(
          postMessage.mock.calls.some(([payload]) =>
            String(payload).startsWith('baci-cart-quantity-result:')
          )
        ).toBe(true)
      );
    });

    await act(async () => {
      sendChatwootWidgetMessage(target, 'baci-cart-quantity', request);
      await waitFor(() => expect(quantityBodies).toHaveLength(2));
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

    expect(quantityBodies[0]).toEqual(quantityBodies[1]);
    expect(quantityBodies[0]).toMatchObject({
      cartVersion: 8,
      expectedQuantity: 2,
      lineId: 'server-line',
      quantity: 3,
      requestId: 'quantity-replay-01',
    });
    expect(mocks.cartState.refreshSharedCart).toHaveBeenCalledOnce();
  });

  it('refreshes a same-context commit even when a later quantity action supersedes its reply', async () => {
    const firstMutation = {
      resolve: undefined as
        | ((response: {
            ok: true;
            json: () => Promise<Record<string, unknown>>;
          }) => void)
        | undefined,
    };
    let quantityCalls = 0;
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
        if (url.pathname.endsWith('/quantity')) {
          quantityCalls += 1;
          if (quantityCalls === 1) {
            return new Promise((resolve) => {
              firstMutation.resolve = resolve as typeof firstMutation.resolve;
            });
          }
          return { ok: false, json: async () => ({}) };
        }
        return authorizedCartResponse(905);
      })
    );
    const { cart, postMessage, target } = await mountWithCartView();
    const item = cart.items[0];
    const message = (requestId: string) => ({
      requestId,
      lineToken: item.lineToken,
      cartVersion: cart.cartVersion,
      expectedQuantity: item.quantity,
      quantity: item.quantity + 1,
      conversationId: 905,
      sessionToken: 'session-905',
    });

    await act(async () => {
      sendChatwootWidgetMessage(
        target,
        'baci-cart-quantity',
        message('quantity-overlap-first')
      );
      await waitFor(() => expect(quantityCalls).toBe(1));
      sendChatwootWidgetMessage(
        target,
        'baci-cart-quantity',
        message('quantity-overlap-second')
      );
      await waitFor(() => expect(quantityCalls).toBe(2));
    });

    firstMutation.resolve?.({
      ok: true,
      json: async () => ({
        accepted: true,
        cartVersion: 9,
        operationId: 'quantity-overlap-first',
      }),
    });
    await waitFor(() =>
      expect(mocks.cartState.refreshSharedCart).toHaveBeenCalledOnce()
    );
    expect(
      postMessage.mock.calls.some(([payload]) => {
        const raw = String(payload);
        return (
          raw.startsWith('baci-cart-quantity-result:') &&
          JSON.parse(raw.slice('baci-cart-quantity-result:'.length))
            .requestId === 'quantity-overlap-first'
        );
      })
    ).toBe(false);
  });
});

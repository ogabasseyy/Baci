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

function messagePayloads(calls: [unknown, ...unknown[]][], prefix: string) {
  return calls
    .map(([payload]) => String(payload))
    .filter((payload) => payload.startsWith(prefix))
    .map((payload) => JSON.parse(payload.slice(prefix.length)));
}

describe('Chatwoot session renewal races', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.cartState.merchantSlug = 'store';
    mocks.cartState.sharedCartRef = { cartId: 'cart-1', version: 8 };
  });

  it('retains an overlapping quantity renewal token after the older response arrives', async () => {
    const { target, postMessage } = installChatwootFrame();
    const authorizeBodies: Record<string, unknown>[] = [];
    const pendingMutations = new Map<
      string,
      (value: {
        ok: true;
        json: () => Promise<Record<string, unknown>>;
      }) => void
    >();
    let authorizationCount = 0;
    let olderMutationParsed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const route = new URL(path, 'https://store.test').pathname;
        if (route.endsWith('/challenge')) {
          return Promise.resolve(challengeResponse(String(body.requestId)));
        }
        if (route.endsWith('/verify')) {
          return Promise.resolve(contextResponse(String(body.contextToken)));
        }
        if (route.endsWith('/authorize')) {
          authorizeBodies.push(body);
          const token = ['auth-cart', 'auth-a', 'auth-b', 'auth-review'][
            authorizationCount
          ];
          authorizationCount += 1;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              authorized: true,
              conversationId: 905,
              sessionExpiresAt: Math.floor(Date.now() / 1000) + 300,
              sessionToken: token,
              cartSnapshot: CANONICAL_CART_SNAPSHOT,
            }),
          });
        }
        if (route.endsWith('/quantity')) {
          return new Promise<{
            ok: true;
            json: () => Promise<Record<string, unknown>>;
          }>((resolve) =>
            pendingMutations.set(String(body.requestId), resolve)
          );
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      })
    );
    render(<HookHarness />);

    await act(async () => {
      await establishChatwootWidgetContext(target, postMessage);
      sendChatwootWidgetMessage(target, 'baci-cart-request', {
        requestId: 'cart-initial',
        conversationId: 905,
        sessionToken: 'session-905',
      });
      await waitFor(() =>
        expect(
          messagePayloads(postMessage.mock.calls, 'baci-cart-view:')
        ).toHaveLength(1)
      );
    });
    const initialView = messagePayloads(
      postMessage.mock.calls,
      'baci-cart-view:'
    )[0];
    const lineToken = initialView?.items[0]?.lineToken;
    expect(typeof lineToken).toBe('string');

    await act(async () => {
      for (const requestId of ['quantity-a', 'quantity-b']) {
        sendChatwootWidgetMessage(target, 'baci-cart-quantity', {
          requestId,
          conversationId: 905,
          sessionToken: 'session-905',
          cartVersion: 8,
          expectedQuantity: 2,
          quantity: 3,
          lineToken,
        });
        await waitFor(() => expect(pendingMutations.has(requestId)).toBe(true));
      }
      pendingMutations.get('quantity-b')?.({
        ok: true,
        json: async () => ({
          accepted: true,
          cartVersion: 9,
          operationId: 'quantity-b',
          sessionToken: 'renewed-b',
        }),
      });
      await waitFor(() =>
        expect(
          messagePayloads(postMessage.mock.calls, 'baci-cart-quantity-result:')
        ).toEqual([expect.objectContaining({ requestId: 'quantity-b' })])
      );
      pendingMutations.get('quantity-a')?.({
        ok: true,
        json: async () => {
          olderMutationParsed = true;
          return {
            accepted: true,
            cartVersion: 9,
            operationId: 'quantity-a',
            sessionToken: 'renewed-a',
          };
        },
      });
      await waitFor(() => expect(olderMutationParsed).toBe(true));
      sendChatwootWidgetMessage(target, 'baci-checkout-review-request', {
        requestId: 'review-after-overlap',
        conversationId: 905,
        sessionToken: 'session-905',
      });
      await waitFor(() => expect(authorizeBodies).toHaveLength(4));
    });

    expect(authorizeBodies[3]?.sessionToken).toBe('renewed-b');
  });
});

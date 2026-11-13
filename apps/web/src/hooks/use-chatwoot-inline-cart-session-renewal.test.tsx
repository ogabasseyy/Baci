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

function quantityMessage(lineToken: string, requestId: string) {
  return {
    requestId,
    lineToken,
    cartVersion: 8,
    expectedQuantity: 2,
    quantity: 3,
    conversationId: 905,
    sessionToken: 'session-905',
  };
}

describe('Chatwoot session renewal after shared-cart edits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.cartState.sharedCartRef = { cartId: 'cart-1', version: 8 };
  });

  it('recovers a lost proof-renewal response without repeating the mutation', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    let authorizeCalls = 0;
    let quantityCalls = 0;
    let committedWrites = 0;
    const renewedSnapshot = {
      ...CANONICAL_CART_SNAPSHOT,
      cartVersion: 9,
      items: CANONICAL_CART_SNAPSHOT.items.map((line) => ({
        ...line,
        quantity: 3,
        lineTotalMinor: line.unitPriceMinor * 3,
      })),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init: RequestInit) => {
        const url = new URL(path, 'https://store.test');
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push({ path: url.pathname, body });
        if (url.pathname.endsWith('/challenge')) {
          return challengeResponse(String(body.requestId));
        }
        if (url.pathname.endsWith('/verify')) {
          return contextResponse(String(body.contextToken));
        }
        if (url.pathname.endsWith('/quantity')) {
          quantityCalls += 1;
          if (quantityCalls === 1) {
            // The server committed and rotated both proofs, then the response
            // body was lost before the bridge could learn the new capability.
            committedWrites += 1;
            throw new Error('response body lost after Set-Cookie');
          }
          return {
            ok: true,
            json: async () => ({
              accepted: true,
              cartVersion: 9,
              replayed: true,
              sessionToken: 'renewed-session-905',
            }),
          };
        }
        if (url.pathname.endsWith('/authorize')) {
          authorizeCalls += 1;
          if (authorizeCalls === 3) {
            return {
              ok: true,
              json: async () => ({
                authorized: true,
                conversationId: 905,
                sessionExpiresAt: Math.floor(Date.now() / 1000) + 60,
                sessionToken: 'rebound-session-905',
                cartSnapshot: renewedSnapshot,
              }),
            };
          }
          return authorizedCartResponse(905);
        }
        return { ok: false, json: async () => ({}) };
      })
    );
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
    const cartView = JSON.parse(
      String(postMessage.mock.calls.at(-1)?.[0]).slice('baci-cart-view:'.length)
    );
    const lineToken = cartView.items[0].lineToken as string;

    for (const [attempt, requestId] of [
      'quantity-replay-01',
      'quantity-replay-01',
    ].entries()) {
      await act(async () => {
        sendChatwootWidgetMessage(
          target,
          'baci-cart-quantity',
          quantityMessage(lineToken, requestId)
        );
        await waitFor(() =>
          expect(
            postMessage.mock.calls.filter(([payload]) => {
              const text = String(payload);
              return (
                text.startsWith('baci-cart-quantity-result:') &&
                JSON.parse(text.slice('baci-cart-quantity-result:'.length))
                  .requestId === requestId
              );
            })
          ).toHaveLength(attempt + 1)
        );
      });
    }

    const authorizeRequests = requests.filter(({ path }) =>
      path.endsWith('/authorize')
    );
    const quantityRequests = requests.filter(({ path }) =>
      path.endsWith('/quantity')
    );
    expect(authorizeRequests.map(({ body }) => body.sessionToken)).toEqual([
      'session-905',
      'session-905',
      'session-905',
    ]);
    expect(quantityRequests.map(({ body }) => body.sessionToken)).toEqual([
      'session-905',
      'rebound-session-905',
    ]);
    expect(quantityRequests[0].body).toMatchObject({
      cartVersion: 8,
      expectedQuantity: 2,
      quantity: 3,
      requestId: 'quantity-replay-01',
    });
    const { sessionToken: _firstToken, ...firstOperation } =
      quantityRequests[0].body;
    const { sessionToken: _secondToken, ...retriedOperation } =
      quantityRequests[1].body;
    expect(retriedOperation).toEqual(firstOperation);
    expect(committedWrites).toBe(1);
  });
});

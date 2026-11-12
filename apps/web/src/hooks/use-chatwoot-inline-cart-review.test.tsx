import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

  it('authorizes the request and renders only canonical server values', async () => {
    const { target, postMessage } = installFrame();
    render(<HookHarness storeSlug="store" widgetOrigin={origin} />);

    await act(async () => {
      await establishWidgetContext(target, postMessage);
      postMessage.mockClear();
      sendWidgetMessage(target, 'baci-checkout-review-request', {
        requestId: 'review-0001',
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

    expect(fetch).toHaveBeenCalledWith(
      '/api/storefront/chatwoot/context/authorize?merchantSlug=store',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        body: JSON.stringify({
          sessionToken: 'session-905',
          includeCartSnapshot: true,
        }),
      })
    );
    const payload = String(postMessage.mock.calls.at(-1)?.[0]);
    expect(payload.startsWith('baci-checkout-review:')).toBe(true);
    const result = JSON.parse(payload.slice('baci-checkout-review:'.length));
    expect(result).toMatchObject({
      status: 'ready',
      subtotalMinor: 250000,
      items: [
        {
          name: 'Canonical Server Phone',
          quantity: 2,
          unitPriceMinor: 125000,
          lineTotalMinor: 250000,
        },
      ],
    });
    expect(payload).not.toContain('Forged local name');
  });
});

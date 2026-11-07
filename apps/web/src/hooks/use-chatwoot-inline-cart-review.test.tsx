import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const origin = 'https://chatwoot.example.com';
const canonicalSnapshot = {
  cartVersion: 8,
  currency: 'NGN',
  estimatedTotals: false,
  items: [
    {
      lineId: 'server-line',
      name: 'Canonical Server Phone',
      productId: 'server-product',
      variantId: null,
      condition: null,
      quantity: 2,
      unitPriceMinor: 125000,
      lineTotalMinor: 250000,
    },
  ],
  itemsSubtotalMinor: 250000,
};

function installFrame() {
  const holder = document.createElement('div');
  holder.id = 'cw-widget-holder';
  const frame = document.createElement('iframe');
  frame.id = 'chatwoot_live_chat_widget';
  holder.append(frame);
  document.body.append(holder);
  const target = frame.contentWindow;
  if (!target) throw new Error('Expected the iframe to have a content window');
  const postMessage = vi
    .spyOn(target, 'postMessage')
    .mockImplementation(() => {});
  return { holder, frame, target, postMessage };
}

function sendWidgetMessage(
  target: Window,
  event: string,
  data: Record<string, unknown>
) {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin,
      source: target,
      data: `${event}:${JSON.stringify(data)}`,
    })
  );
}

function response(conversationId: number, snapshot = canonicalSnapshot) {
  return {
    ok: true,
    json: async () => ({
      authorized: true,
      conversationId,
      sessionExpiresAt: Math.floor(Date.now() / 1000) + 60,
      cartSnapshot: snapshot,
    }),
  };
}

function challengeResponse(requestId: string) {
  return {
    ok: true,
    json: async () => ({
      requestId,
      widgetOrigin: origin,
      challengeToken: `challenge-${requestId}`,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    }),
  };
}

function contextResponse(contextToken: string) {
  const conversationId = Number(contextToken.split('-').at(-1));
  const requestId =
    conversationId === 906 ? 'context_654321' : 'context_123456';
  return {
    ok: true,
    json: async () => ({
      authorized: true,
      requestId,
      conversationId,
      sessionToken: `session-${conversationId}`,
      sessionExpiresAt: Math.floor(Date.now() / 1000) + 60,
    }),
  };
}

async function establishWidgetContext(
  target: Window,
  postMessage: ReturnType<typeof installFrame>['postMessage'],
  conversationId = 905
) {
  const requestId =
    conversationId === 906 ? 'context_654321' : 'context_123456';
  postMessage.mockClear();
  sendWidgetMessage(target, 'baci-commerce-context-request', {
    requestId,
    conversationId,
    websiteToken: 'synthetic-widget-token-123456',
    visitorTokenSha256: 'b'.repeat(64),
  });
  await waitFor(() =>
    expect(
      postMessage.mock.calls.some(([payload]) =>
        String(payload).startsWith('baci-commerce-context-challenge:')
      )
    ).toBe(true)
  );
  sendWidgetMessage(target, 'baci-commerce-context-ready', {
    requestId,
    conversationId,
    contextToken: `context-${conversationId}`,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  });
  await waitFor(() =>
    expect(
      postMessage.mock.calls.some(([payload]) =>
        String(payload).startsWith('baci-commerce-context-authorized:')
      )
    ).toBe(true)
  );
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
        if (path.endsWith('/challenge')) {
          return challengeResponse(String(body.requestId));
        }
        if (path.endsWith('/verify')) {
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
      '/api/storefront/chatwoot/context/authorize',
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

import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const snapshot = {
  cartVersion: 8,
  currency: 'NGN',
  estimatedTotals: false,
  items: [],
  itemsSubtotalMinor: 0,
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
  return { holder, target, postMessage };
}

function send(target: Window, event: string, data: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin,
      source: target,
      data: `${event}:${JSON.stringify(data)}`,
    })
  );
}

function authorizedResponse(conversationId: number) {
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

async function establishContext(target: Window, conversationId = 905) {
  const requestId =
    conversationId === 906 ? 'context_654321' : 'context_123456';
  send(target, 'baci-commerce-context-request', {
    requestId,
    conversationId,
    websiteToken: 'synthetic-widget-token-123456',
    visitorTokenSha256: 'b'.repeat(64),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  send(target, 'baci-commerce-context-ready', {
    requestId,
    conversationId,
    contextToken: `context-${conversationId}`,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ChatwootInlineCartBridge async context races', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.cartState.merchantSlug = 'store';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (path.endsWith('/challenge')) {
          return {
            ok: true,
            json: async () => ({
              requestId: body.requestId,
              widgetOrigin: origin,
              challengeToken: `challenge-${body.requestId}`,
              expiresAt: Math.floor(Date.now() / 1000) + 60,
            }),
          };
        }
        if (path.endsWith('/verify')) {
          return contextResponse(String(body.contextToken));
        }
        return authorizedResponse(905);
      })
    );
  });

  it('discards an authorization response after the conversation changes', async () => {
    const { target, postMessage } = installFrame();
    let resolveAuthorize:
      | ((value: ReturnType<typeof authorizedResponse>) => void)
      | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (path.endsWith('/challenge')) {
          return {
            ok: true,
            json: async () => ({
              requestId: body.requestId,
              widgetOrigin: origin,
              challengeToken: `challenge-${body.requestId}`,
              expiresAt: Math.floor(Date.now() / 1000) + 60,
            }),
          };
        }
        if (path.endsWith('/verify'))
          return contextResponse(String(body.contextToken));
        return new Promise((resolve) => {
          resolveAuthorize = resolve;
        });
      })
    );
    render(<HookHarness storeSlug="store" widgetOrigin={origin} />);

    await act(async () => {
      await establishContext(target);
      send(target, 'baci-checkout-review-request', {
        requestId: 'review-0001',
        conversationId: 905,
        sessionToken: 'session-905',
      });
    });
    await act(async () => {
      send(target, 'baci-commerce-context-request', {
        requestId: 'context_654321',
        conversationId: 906,
        websiteToken: 'synthetic-widget-token-123456',
        visitorTokenSha256: 'b'.repeat(64),
      });
      await Promise.resolve();
      resolveAuthorize?.(authorizedResponse(905));
      await Promise.resolve();
    });

    expect(
      postMessage.mock.calls.some((call) =>
        String(call[0]).startsWith('baci-checkout-review:')
      )
    ).toBe(false);
  });

  it('discards an authorization response after iframe navigation or merchant switch', async () => {
    const { holder, target, postMessage } = installFrame();
    let resolveFetch:
      | ((value: ReturnType<typeof authorizedResponse>) => void)
      | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (path.endsWith('/challenge')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              requestId: body.requestId,
              widgetOrigin: origin,
              challengeToken: `challenge-${body.requestId}`,
              expiresAt: Math.floor(Date.now() / 1000) + 60,
            }),
          });
        }
        if (path.endsWith('/verify')) {
          return Promise.resolve(contextResponse(String(body.contextToken)));
        }
        return new Promise((resolve) => {
          resolveFetch = resolve;
        });
      })
    );
    const view = render(
      <HookHarness storeSlug="store" widgetOrigin={origin} />
    );
    await act(async () => {
      await establishContext(target);
      postMessage.mockClear();
      send(target, 'baci-checkout-review-request', {
        requestId: 'review-0003',
        conversationId: 905,
        sessionToken: 'session-905',
      });
    });
    holder.replaceChildren(document.createElement('iframe'));
    mocks.cartState.merchantSlug = 'another-store';
    view.rerender(
      <HookHarness storeSlug="another-store" widgetOrigin={origin} />
    );
    await act(async () => {
      resolveFetch?.(authorizedResponse(905));
      await Promise.resolve();
    });
    expect(postMessage).not.toHaveBeenCalled();
  });
});

import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authorizedEmptyCartResponse as authorizedResponse,
  challengeResponse,
  contextResponse,
  establishChatwootWidgetContext as establishContext,
  installChatwootFrame as installFrame,
  CHATWOOT_WIDGET_ORIGIN as origin,
  sendChatwootWidgetMessage as send,
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

describe('ChatwootInlineCartBridge async context races', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.cartState.merchantSlug = 'store';
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
        return authorizedResponse(905);
      })
    );
  });

  it('discards an authorization response after the conversation changes', async () => {
    const { target, postMessage } = installFrame();
    let authorizationParsed = false;
    let resolveAuthorize:
      | ((value: ReturnType<typeof authorizedResponse>) => void)
      | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (
          new URL(path, 'https://store.test').pathname.endsWith('/challenge')
        ) {
          return challengeResponse(String(body.requestId));
        }
        if (new URL(path, 'https://store.test').pathname.endsWith('/verify'))
          return contextResponse(String(body.contextToken));
        return new Promise((resolve) => {
          resolveAuthorize = resolve;
        });
      })
    );
    render(<HookHarness storeSlug="store" widgetOrigin={origin} />);

    await act(async () => {
      await establishContext(target, postMessage);
      send(target, 'baci-checkout-review-request', {
        requestId: 'review-0001',
        conversationId: 905,
        sessionToken: 'session-905',
      });
    });
    await act(async () => {
      await establishContext(target, postMessage, 906);
      resolveAuthorize?.(
        authorizedResponse(905, () => {
          authorizationParsed = true;
        })
      );
      await waitFor(() => expect(authorizationParsed).toBe(true));
    });

    expect(
      postMessage.mock.calls.some((call) =>
        String(call[0]).startsWith('baci-checkout-review:')
      )
    ).toBe(false);
  });

  it.each([
    'iframe navigation',
    'merchant switch',
  ] as const)('discards an authorization response after %s', async (change) => {
    const { holder, target, postMessage } = installFrame();
    let resolveFetch:
      | ((value: ReturnType<typeof authorizedResponse>) => void)
      | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (
          new URL(path, 'https://store.test').pathname.endsWith('/challenge')
        ) {
          return Promise.resolve(challengeResponse(String(body.requestId)));
        }
        if (new URL(path, 'https://store.test').pathname.endsWith('/verify')) {
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
      await establishContext(target, postMessage);
      postMessage.mockClear();
      send(target, 'baci-checkout-review-request', {
        requestId: 'review-0003',
        conversationId: 905,
        sessionToken: 'session-905',
      });
      await waitFor(() =>
        expect(fetch).toHaveBeenCalledWith(
          '/api/storefront/chatwoot/context/authorize?merchantSlug=store',
          expect.anything()
        )
      );
    });
    if (change === 'iframe navigation') {
      holder.replaceChildren(document.createElement('iframe'));
    } else {
      mocks.cartState.merchantSlug = 'another-store';
      view.rerender(
        <HookHarness storeSlug="another-store" widgetOrigin={origin} />
      );
    }
    await act(async () => {
      let authorizationParsed = false;
      resolveFetch?.(
        authorizedResponse(905, () => {
          authorizationParsed = true;
        })
      );
      await waitFor(() => expect(authorizationParsed).toBe(true));
    });
    expect(postMessage).not.toHaveBeenCalled();
  });
});

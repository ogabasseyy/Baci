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

function stubDeferredAuthorizations(
  pending: Array<(value: ReturnType<typeof authorizedCartResponse>) => void>
) {
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
      return new Promise((resolve) => pending.push(resolve));
    })
  );
}

function messagePayloads(calls: [unknown, ...unknown[]][], prefix: string) {
  return calls
    .map(([payload]) => String(payload))
    .filter((payload) => payload.startsWith(prefix))
    .map((payload) => JSON.parse(payload.slice(prefix.length)));
}

describe('Chatwoot cart and review response ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.cartState.merchantSlug = 'store';
    mocks.cartState.sharedCartRef = { cartId: 'cart-1', version: 8 };
  });

  it('returns not-ready for a current cart request made stale by cart replacement', async () => {
    const { target, postMessage } = installChatwootFrame();
    const pending: Array<
      (value: ReturnType<typeof authorizedCartResponse>) => void
    > = [];
    stubDeferredAuthorizations(pending);
    const view = render(<HookHarness />);

    await act(async () => {
      await establishChatwootWidgetContext(target, postMessage);
      postMessage.mockClear();
      sendChatwootWidgetMessage(target, 'baci-cart-request', {
        requestId: 'cart-replaced',
        conversationId: 905,
        sessionToken: 'session-905',
      });
      await waitFor(() => expect(pending).toHaveLength(1));
    });
    mocks.cartState.sharedCartRef = { cartId: 'cart-2', version: 9 };
    view.rerender(<HookHarness />);

    await act(async () => {
      pending[0](authorizedCartResponse(905));
      await waitFor(() =>
        expect(
          messagePayloads(postMessage.mock.calls, 'baci-cart-view:')
        ).toEqual([{ requestId: 'cart-replaced', ready: false, items: [] }])
      );
    });
  });

  it('suppresses the older same-version cart response when a newer read finishes first', async () => {
    const { target, postMessage } = installChatwootFrame();
    const pending: Array<
      (value: ReturnType<typeof authorizedCartResponse>) => void
    > = [];
    let olderResponseParsed = false;
    stubDeferredAuthorizations(pending);
    render(<HookHarness />);

    await act(async () => {
      await establishChatwootWidgetContext(target, postMessage);
      postMessage.mockClear();
      sendChatwootWidgetMessage(target, 'baci-cart-request', {
        requestId: 'cart-old',
        conversationId: 905,
        sessionToken: 'session-905',
      });
      await waitFor(() => expect(pending).toHaveLength(1));
      sendChatwootWidgetMessage(target, 'baci-cart-request', {
        requestId: 'cart-new',
        conversationId: 905,
        sessionToken: 'session-905',
      });
      await waitFor(() => expect(pending).toHaveLength(2));
      pending[1](authorizedCartResponse(905));
      await waitFor(() =>
        expect(
          messagePayloads(postMessage.mock.calls, 'baci-cart-view:')
        ).toHaveLength(1)
      );
      pending[0](
        authorizedCartResponse(905, () => {
          olderResponseParsed = true;
        })
      );
      await waitFor(() => expect(olderResponseParsed).toBe(true));
    });

    expect(messagePayloads(postMessage.mock.calls, 'baci-cart-view:')).toEqual([
      expect.objectContaining({ requestId: 'cart-new', cartVersion: 8 }),
    ]);
  });

  it('suppresses an older checkout review result after a newer review request', async () => {
    const { target, postMessage } = installChatwootFrame();
    const pending: Array<
      (value: ReturnType<typeof authorizedCartResponse>) => void
    > = [];
    let olderResponseParsed = false;
    stubDeferredAuthorizations(pending);
    render(<HookHarness />);

    await act(async () => {
      await establishChatwootWidgetContext(target, postMessage);
      postMessage.mockClear();
      sendChatwootWidgetMessage(target, 'baci-checkout-review-request', {
        requestId: 'review-old',
        conversationId: 905,
        sessionToken: 'session-905',
      });
      await waitFor(() => expect(pending).toHaveLength(1));
      sendChatwootWidgetMessage(target, 'baci-checkout-review-request', {
        requestId: 'review-new',
        conversationId: 905,
        sessionToken: 'session-905',
      });
      await waitFor(() => expect(pending).toHaveLength(2));
      pending[1](authorizedCartResponse(905));
      await waitFor(() =>
        expect(
          messagePayloads(postMessage.mock.calls, 'baci-checkout-review:')
        ).toHaveLength(1)
      );
      pending[0](
        authorizedCartResponse(905, () => {
          olderResponseParsed = true;
        })
      );
      await waitFor(() => expect(olderResponseParsed).toBe(true));
    });

    expect(
      messagePayloads(postMessage.mock.calls, 'baci-checkout-review:')
    ).toEqual([expect.objectContaining({ requestId: 'review-new' })]);
  });
});

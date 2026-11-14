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
    cart: [],
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

const product = {
  availability: 'in_stock',
  condition: 'new',
  currency: 'NGN',
  name: 'Phone 15',
  price: 300_000,
  slug: 'phone-15',
  variants: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  mocks.cartState.merchantSlug = 'store';
  mocks.cartState.sharedCartRef = { cartId: 'cart-1', version: 8 };
  mocks.cartState.syncStatus = 'synced';
});

async function runProductLookup(onAuthorization: () => void): Promise<{
  postMessage: ReturnType<typeof installFrame>['postMessage'];
  fetchMock: ReturnType<typeof vi.fn>;
}> {
  const fetchMock = vi.fn(async (path: string, init: RequestInit) => {
    const pathname = new URL(path, 'https://store.test').pathname;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    if (pathname.endsWith('/challenge')) {
      return challengeResponse(String(body.requestId));
    }
    if (pathname.endsWith('/verify')) {
      return contextResponse(String(body.contextToken));
    }
    if (pathname.endsWith('/authorize')) {
      return response(905, onAuthorization);
    }
    if (pathname.endsWith('/products')) {
      return {
        ok: true,
        json: async () => ({ ok: true, product, requestId: body.requestId }),
      };
    }
    throw new Error(`Unexpected bridge request: ${pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
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

  return { postMessage, fetchMock };
}

describe('Chatwoot product lookup cart freshness', () => {
  it('allows a catalog lookup when the same cart advances during authorization', async () => {
    const { postMessage, fetchMock } = await runProductLookup(() => {
      mocks.cartState.sharedCartRef = { cartId: 'cart-1', version: 9 };
    });

    const payload = String(postMessage.mock.calls.at(-1)?.[0]);
    expect(JSON.parse(payload.slice('baci-product-response:'.length))).toEqual({
      requestId: 'product-0001',
      status: 'available',
      product,
    });
    expect(
      fetchMock.mock.calls.some(([path]) =>
        new URL(String(path), 'https://store.test').pathname.endsWith(
          '/products'
        )
      )
    ).toBe(true);
  });

  it.each([
    [
      'a substituted cart',
      () => {
        mocks.cartState.sharedCartRef = { cartId: 'cart-2', version: 9 };
      },
    ],
    [
      'a cart-version rollback',
      () => {
        mocks.cartState.sharedCartRef = { cartId: 'cart-1', version: 7 };
      },
    ],
  ])('rejects product lookup after %s', async (_label, mutateCart) => {
    const { postMessage, fetchMock } = await runProductLookup(mutateCart);

    const payload = String(postMessage.mock.calls.at(-1)?.[0]);
    expect(JSON.parse(payload.slice('baci-product-response:'.length))).toEqual({
      requestId: 'product-0001',
      status: 'unavailable',
      code: 'invalid_context',
    });
    expect(
      fetchMock.mock.calls.some(([path]) =>
        new URL(String(path), 'https://store.test').pathname.endsWith(
          '/products'
        )
      )
    ).toBe(false);
  });
});

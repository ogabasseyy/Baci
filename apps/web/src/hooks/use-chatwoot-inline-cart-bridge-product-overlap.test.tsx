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
    ensureSharedCartSession: vi.fn(async () => ({ ok: true as const })),
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

function HookHarness() {
  useChatwootInlineCartBridge('store', origin);
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
});

async function setup(releaseAuthorization: Promise<void>) {
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
      await releaseAuthorization;
      return response(905);
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
  render(<HookHarness />);
  await act(async () => {
    await establishWidgetContext(target, postMessage);
    postMessage.mockClear();
  });
  return { postMessage, target };
}

const productRequest = (requestId: string) => ({
  requestId,
  conversationId: 905,
  sessionToken: 'session-905',
  slug: 'phone-15',
});

function productResponses(
  postMessage: ReturnType<typeof installFrame>['postMessage']
) {
  return postMessage.mock.calls
    .map(([payload]) => String(payload))
    .filter((payload) => payload.startsWith('baci-product-response:'))
    .map((payload) =>
      JSON.parse(payload.slice('baci-product-response:'.length))
    );
}

describe('Chatwoot overlapping product lookups', () => {
  it('answers every overlapping product request with its own request id', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { postMessage, target } = await setup(gate);

    await act(async () => {
      sendWidgetMessage(
        target,
        'baci-product-request',
        productRequest('product-0001')
      );
      sendWidgetMessage(
        target,
        'baci-product-request',
        productRequest('product-0002')
      );
      release();
      await waitFor(() =>
        expect(productResponses(postMessage)).toHaveLength(2)
      );
    });

    expect(productResponses(postMessage)).toEqual(
      expect.arrayContaining([
        { requestId: 'product-0001', status: 'available', product },
        { requestId: 'product-0002', status: 'available', product },
      ])
    );
  });

  it('still answers a pending product lookup when a cart request arrives', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { postMessage, target } = await setup(gate);

    await act(async () => {
      sendWidgetMessage(
        target,
        'baci-product-request',
        productRequest('product-0003')
      );
      sendWidgetMessage(target, 'baci-cart-request', {
        requestId: 'cart-request-01',
        conversationId: 905,
        sessionToken: 'session-905',
      });
      release();
      await waitFor(() =>
        expect(productResponses(postMessage)).toHaveLength(1)
      );
    });

    expect(productResponses(postMessage)).toEqual([
      { requestId: 'product-0003', status: 'available', product },
    ]);
  });
});

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
    ensureSharedCartSession: vi.fn(async () => ({ ok: true as const })),
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
vi.mock('@/lib/csrf', () => ({
  CSRF_HEADER_NAME: 'x-csrf-token',
  buildCsrfHeaders: mocks.buildCsrfHeaders,
  getClientCsrfToken: () => 'csrf-token',
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ merchant: { id: 'merchant-1' } }),
}));
vi.mock('@/config/oxygen-storefront-staging', () => ({
  isOxygenStorefrontStagingEnabled: () => true,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { email: 'ada@example.com' } } }),
    },
  }),
}));

import {
  rememberChatwootCheckoutOrder,
  rememberChatwootCheckoutPayment,
  resetChatwootCheckoutOrderMemory,
} from './chatwoot-checkout-memory';
import { useChatwootInlineCartBridge } from './use-chatwoot-inline-cart-bridge';

function HookHarness({
  checkoutEnabled,
  openSecureApplication,
}: {
  checkoutEnabled?: boolean;
  openSecureApplication?: (path: string) => void;
}) {
  useChatwootInlineCartBridge(
    'store',
    origin,
    checkoutEnabled,
    openSecureApplication
  );
  return null;
}

const placeData = {
  requestId: 'place-request-1',
  conversationId: 905,
  sessionToken: 'session-905',
  cartVersion: 3,
  customer: {
    firstName: 'Ada',
    lastName: 'Obi',
    email: 'ada@example.com',
    phone: '+2348012345678',
  },
  address: { line1: '12 Admiralty Way', city: 'Lekki', state: 'Lagos' },
  delivery: {
    displayName: 'Standard delivery',
    priceMajor: 2500,
    pickup: false,
  },
};
const statusData = {
  requestId: 'status-request-1',
  conversationId: 905,
  sessionToken: 'session-905',
  reference: 'ref-123',
};

function widgetPosts(
  postMessage: ReturnType<typeof installFrame>['postMessage'],
  prefix: string
) {
  return postMessage.mock.calls
    .map(([payload]) => String(payload))
    .filter((payload) => payload.startsWith(prefix))
    .map((payload) => JSON.parse(payload.slice(prefix.length)));
}

describe('ChatwootInlineCartBridge in-chat checkout', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.cartState.sharedCartRef = { cartId: 'cart-1', version: 8 };
    fetchMock = vi.fn(async (path: string, init: RequestInit = {}) => {
      const url = new URL(path, 'https://store.test');
      if (url.pathname === '/api/storefront/orders/track-order') {
        return {
          ok: true,
          json: async () => ({
            order: { id: 'order-1', payment_status: 'paid' },
          }),
        };
      }
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (url.pathname.endsWith('/challenge')) {
        return challengeResponse(String(body.requestId));
      }
      if (url.pathname.endsWith('/verify')) {
        return contextResponse(String(body.contextToken));
      }
      return response(905);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('opens the secure card for an authorized Oxygen checkout replay', async () => {
    resetChatwootCheckoutOrderMemory();
    const orderId = '6974e8cc-4e90-4ca9-b2cf-aa2abaf461df';
    rememberChatwootCheckoutOrder(
      'saved-order',
      { merchantId: 'merchant-1', conversationId: 905, cartId: 'cart-1' },
      {
        orderId,
        orderNumber: 'ORD-1001',
        trackingToken: null,
        amountDueMajor: 42000,
        currency: 'NGN',
        paymentMethod: 'oxygen',
      }
    );
    const { target, postMessage } = installFrame();
    const openSecureApplication = vi.fn();
    render(
      <HookHarness
        checkoutEnabled
        openSecureApplication={openSecureApplication}
      />
    );
    await act(async () => {
      await establishWidgetContext(target, postMessage);
      sendWidgetMessage(target, 'baci-checkout-place-request', {
        ...placeData,
        cartVersion: 8,
        paymentMethod: 'oxygen',
      });
      await waitFor(
        () =>
          expect(openSecureApplication).toHaveBeenCalledWith(
            `/payments/oxygen/${orderId}`
          ),
        { timeout: 10000 }
      );
    });
    expect(
      fetchMock.mock.calls.some(([path]) => String(path) === '/api/orders')
    ).toBe(false);
  });

  it.each([
    undefined,
    false,
  ])('answers both checkout messages as disabled with no network call when the flag is %s', async (flag) => {
    const { target, postMessage } = installFrame();
    render(<HookHarness checkoutEnabled={flag} />);

    await act(async () => {
      await establishWidgetContext(target, postMessage);
      fetchMock.mockClear();
      sendWidgetMessage(target, 'baci-checkout-place-request', placeData);
      sendWidgetMessage(
        target,
        'baci-checkout-payment-status-request',
        statusData
      );
      await waitFor(() =>
        expect(
          widgetPosts(postMessage, 'baci-checkout-payment-status:')
        ).toHaveLength(1)
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(widgetPosts(postMessage, 'baci-checkout-place-result:')).toEqual([
      { requestId: 'place-request-1', status: 'failed', code: 'disabled' },
    ]);
    expect(widgetPosts(postMessage, 'baci-checkout-payment-status:')).toEqual([
      { requestId: 'status-request-1', status: 'unavailable' },
    ]);
  });

  it('answers a payment status request by polling the created order when enabled', async () => {
    // Only a reference this page issued for its own chat order may be polled.
    resetChatwootCheckoutOrderMemory();
    rememberChatwootCheckoutOrder(
      'issued-key',
      { merchantId: 'merchant-1', conversationId: 905, cartId: 'cart-test' },
      {
        orderId: 'order-1',
        orderNumber: 'ORD-1001',
        trackingToken: 'track-1',
        amountDueMajor: 1000,
        currency: 'NGN',
      }
    );
    rememberChatwootCheckoutPayment('issued-key', {
      bank: {
        bankName: 'Test Bank',
        accountNumber: '0123456789',
        accountName: 'Test Store',
      },
      reference: 'ref-123',
    });
    const { target, postMessage } = installFrame();
    render(<HookHarness checkoutEnabled />);

    await act(async () => {
      await establishWidgetContext(target, postMessage);
      sendWidgetMessage(
        target,
        'baci-checkout-payment-status-request',
        statusData
      );
      await waitFor(() =>
        expect(
          widgetPosts(postMessage, 'baci-checkout-payment-status:')
        ).toHaveLength(1)
      );
    });

    expect(widgetPosts(postMessage, 'baci-checkout-payment-status:')).toEqual([
      { requestId: 'status-request-1', status: 'paid' },
    ]);
    expect(
      fetchMock.mock.calls.some(([path]) =>
        String(path).startsWith(
          '/api/storefront/orders/track-order?token=track-1&merchant_slug=store'
        )
      )
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([path]) =>
        String(path).includes('/api/payments/status')
      )
    ).toBe(false);
  });

  it('authorizes a place request and rejects a stale cart version before any order call', async () => {
    const { target, postMessage } = installFrame();
    render(<HookHarness checkoutEnabled />);

    await act(async () => {
      await establishWidgetContext(target, postMessage);
      sendWidgetMessage(target, 'baci-checkout-place-request', placeData);
      await waitFor(
        () =>
          expect(
            widgetPosts(postMessage, 'baci-checkout-place-result:')
          ).toHaveLength(1),
        // The checkout modules load lazily; a cold transform can exceed 1s.
        { timeout: 10_000 }
      );
    });

    expect(widgetPosts(postMessage, 'baci-checkout-place-result:')).toEqual([
      { requestId: 'place-request-1', status: 'failed', code: 'cart_changed' },
    ]);
    const paths = fetchMock.mock.calls.map(([path]) => String(path));
    expect(paths.some((path) => path.includes('/authorize'))).toBe(true);
    expect(paths.some((path) => path.includes('/api/orders'))).toBe(false);
    expect(paths.some((path) => path.includes('/api/shipping/quotes'))).toBe(
      false
    );
  });
});

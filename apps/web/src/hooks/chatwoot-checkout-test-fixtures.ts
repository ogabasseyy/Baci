import { vi } from 'vitest';
import type { CartItem } from '@/hooks/cart';
import type { SharedCartCheckoutReview } from '@/hooks/cart/shared-cart-checkout-client';
import type { HandleChatwootCheckoutPlaceInput } from './chatwoot-checkout-place-action';

export const CHECKOUT_CART_ID = 'cart-1';
export const CHECKOUT_CART_VERSION = 8;

export const checkoutDisplayCart = [
  {
    id: 'product-1',
    name: 'Phone',
    price: 1000,
    quantity: 2,
    cartItemId: 'local-line',
    serverLineId: 'line-1',
  },
] as unknown as CartItem[];

export const checkoutReview: SharedCartCheckoutReview = {
  checkoutSessionId: 'session-1',
  generation: 3,
  cartVersion: CHECKOUT_CART_VERSION,
  cartId: CHECKOUT_CART_ID,
  merchantId: 'merchant-1',
  subtotalMinor: 200_000,
  currency: 'NGN',
  unavailableCount: 0,
  lines: [
    {
      id: 'line-1',
      productId: 'product-1',
      variantId: null,
      condition: null,
      options: {},
      quantity: 2,
      negotiatedUnitPriceMinor: null,
      negotiationStatus: null,
      negotiationInvalidated: false,
      voucherToken: null,
      voucherAwardId: null,
      hasAssurance: false,
      assuranceRate: null,
      lastUnitPriceMinor: null,
      validatedUnitPriceMinor: 100_000,
      effectiveUnitPriceMinor: 100_000,
      priceChanged: false,
      available: true,
      unavailableReason: null,
      stockQty: 10,
      manageStock: false,
    },
  ],
};

export function merchantQuote(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'mrate_rate-1',
    provider: 'MERCHANT',
    serviceTier: 'standard',
    carrierName: 'Store',
    displayName: 'Standard delivery',
    estimatedDays: 2,
    price: 2500,
    currency: 'NGN',
    pickupIncluded: false,
    insuranceIncluded: false,
    ...overrides,
  };
}

export const checkoutPlaceRequest = {
  requestId: 'place-request-1',
  conversationId: 905,
  sessionToken: 'session-905',
  cartVersion: CHECKOUT_CART_VERSION,
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

export function placeInput(
  overrides: Partial<HandleChatwootCheckoutPlaceInput> = {}
): HandleChatwootCheckoutPlaceInput {
  const ref = { cartId: CHECKOUT_CART_ID, version: CHECKOUT_CART_VERSION };
  return {
    request: checkoutPlaceRequest,
    storeSlug: 'store',
    snapshot: {
      cartVersion: CHECKOUT_CART_VERSION,
      currency: 'NGN',
      estimatedTotals: false,
      itemsSubtotalMinor: 200_000,
    },
    authorizedCartId: CHECKOUT_CART_ID,
    requestedCartRef: ref,
    getCurrentCartRef: () => ref,
    getDisplayCart: () => checkoutDisplayCart,
    getMerchant: () => ({
      id: 'merchant-1',
      taxRate: 0.075,
      bankTransferAvailable: true,
    }),
    isCurrent: () => true,
    canPost: () => true,
    postResult: vi.fn(),
    ...overrides,
  };
}

type Handler = (body: Record<string, unknown>, init: RequestInit) => unknown;

/** A fetch double keyed by path; each handler returns a JSON body and status. */
export function stubCheckoutFetch(handlers: Record<string, Handler>) {
  const calls: { path: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn((input: string | URL, init: RequestInit = {}) => {
    const path = String(input).split('?')[0] ?? '';
    calls.push({ path, init });
    const handler = handlers[path];
    if (!handler) return Promise.reject(new Error(`Unexpected fetch ${path}`));
    try {
      const result = handler(
        init.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : {},
        init
      ) as { status?: number; body: unknown };
      const status = result.status ?? 200;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(JSON.stringify(result.body)),
        json: () => Promise.resolve(result.body),
        headers: new Headers(),
      });
    } catch (error) {
      return Promise.reject(error);
    }
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

export const quotes = (...list: Record<string, unknown>[]) => ({
  body: { quotes: { all: list, featured: [] }, sessionId: 's1' },
});
export const orderCreated = {
  status: 201,
  body: {
    order: {
      id: 'order-uuid',
      order_number: 'ORD-1001',
      total: 4650,
      tracking_token: 'track-1',
      currency: 'NGN',
    },
    amountDueToGateway: 4650,
  },
};
export const dvaReady = {
  body: {
    success: true,
    reference: 'ref-123',
    dva: {
      bank_name: 'Wema Bank',
      account_number: '0123456789',
      account_name: 'Store / Ada Obi',
      bank_code: '035',
    },
  },
};

export function happyHandlers() {
  return {
    '/api/shipping/quotes': () => quotes(merchantQuote()),
    '/api/orders': () => orderCreated,
    '/api/payments/initialize': () => dvaReady,
  };
}

export function lastResult(input: ReturnType<typeof placeInput>) {
  return vi.mocked(input.postResult).mock.calls.at(-1)?.[0];
}

export const paths = (calls: { path: string }[]) =>
  calls.map((call) => call.path);

export function preparedCheckout(review = checkoutReview) {
  return {
    ok: true as const,
    review,
    sessionExpiresAtMonotonicMs: 1,
    sessionExpiresAtEpochMs: 1,
    replayed: false,
    sessionReused: false,
  };
}

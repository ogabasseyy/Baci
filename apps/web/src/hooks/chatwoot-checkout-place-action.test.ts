import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  user: vi.fn(),
  staging: vi.fn(),
}));
vi.mock('@/config/oxygen-storefront-staging', () => ({
  isOxygenStorefrontStagingEnabled: mocks.staging,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: mocks.user } }),
}));

vi.mock('@/hooks/cart/shared-cart-checkout-client', async (importActual) => ({
  ...(await importActual<
    typeof import('@/hooks/cart/shared-cart-checkout-client')
  >()),
  prepareSharedCartCheckout: mocks.prepare,
}));

import {
  handleChatwootCheckoutPlace,
  resetChatwootCheckoutOrderMemory,
} from './chatwoot-checkout-place-action';
import {
  CHECKOUT_CART_ID,
  CHECKOUT_CART_VERSION,
  checkoutPlaceRequest,
  happyHandlers,
  lastResult,
  merchantQuote,
  paths,
  placeInput,
  preparedCheckout,
  quotes,
  stubCheckoutFetch,
} from './chatwoot-checkout-test-fixtures';

beforeEach(() => {
  resetChatwootCheckoutOrderMemory();
  mocks.prepare.mockReset();
  mocks.prepare.mockResolvedValue(preparedCheckout());
  mocks.staging.mockReturnValue(true);
  mocks.user.mockResolvedValue({
    data: { user: { email: 'ada@example.com' } },
    error: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('handleChatwootCheckoutPlace', () => {
  it('places the order with the store checkout contract and returns bank details', async () => {
    const { calls } = stubCheckoutFetch(happyHandlers());
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(paths(calls)).toEqual([
      '/api/shipping/quotes',
      '/api/orders',
      '/api/payments/initialize',
    ]);
    const quoteBody = JSON.parse(String(calls[0]?.init.body));
    expect(quoteBody).toMatchObject({
      merchantId: 'merchant-1',
      merchant_rates_only: true,
      supports_merchant_rates: true,
      receiver: { state: 'Lagos', countryCode: 'NG', city: 'Lekki' },
    });
    expect(mocks.prepare).toHaveBeenCalledWith(
      {
        cartId: CHECKOUT_CART_ID,
        expectedVersion: CHECKOUT_CART_VERSION,
        operationId: expect.stringMatching(/^cw-op-[0-9a-f]{64}$/),
      },
      'store'
    );

    const orderCall = calls[1];
    const headers = orderCall?.init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toMatch(/^cw-chk-[0-9a-f]{64}$/);
    expect(JSON.parse(String(orderCall?.init.body))).toMatchObject({
      merchant_id: 'merchant-1',
      customer_email: 'ada@example.com',
      customer_name: 'Ada Obi',
      customer_phone: '+2348012345678',
      payment_method: 'bank_transfer',
      payment_status: 'unpaid',
      delivery_method: 'door',
      shipping_rate_id: 'rate-1',
      selected_quote_id: null,
      shipping_provider: null,
      shipping_fee: 2500,
      subtotal: 2000,
      tax_amount: 150,
      expected_total: 4650,
      use_wallet_credit: false,
      wallet_amount: 0,
      gift_wrapping_fee: 0,
      shipping_address: {
        address: '12 Admiralty Way',
        city: 'Lekki',
        state: 'Lagos',
        countryCode: 'NG',
      },
      shared_cart: {
        cart_id: 'cart-1',
        checkout_session_id: 'session-1',
        checkout_generation: 3,
        cart_version: 8,
      },
    });
    expect(JSON.parse(String(calls[2]?.init.body))).toMatchObject({
      gateway: 'paystack',
      payment_type: 'bank_transfer',
      order_id: 'order-uuid',
      merchant_id: 'merchant-1',
      customer_email: 'ada@example.com',
      currency: 'NGN',
      tracking_token: 'track-1',
    });
    expect(input.postResult).toHaveBeenCalledTimes(1);
    expect(lastResult(input)).toEqual({
      requestId: 'place-request-1',
      status: 'payment_ready',
      orderNumber: 'ORD-1001',
      amountMajor: 4650,
      currency: 'NGN',
      bank: {
        bankName: 'Wema Bank',
        accountNumber: '0123456789',
        accountName: 'Store / Ada Obi',
      },
      reference: 'ref-123',
    });
  });

  it('charges no VAT for an unregistered merchant', async () => {
    const { calls } = stubCheckoutFetch(happyHandlers());

    await handleChatwootCheckoutPlace(
      placeInput({
        getMerchant: () => ({
          id: 'merchant-1',
          taxRate: 0,
          bankTransferAvailable: true,
        }),
      })
    );

    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({
      tax_amount: 0,
      expected_total: 4500,
    });
  });

  it('routes a pickup choice to the station-pickup delivery method', async () => {
    const { calls } = stubCheckoutFetch({
      ...happyHandlers(),
      '/api/shipping/quotes': () =>
        quotes(
          merchantQuote(),
          merchantQuote({
            id: 'mrate_pickup-1',
            displayName: 'Ikeja pickup',
            price: 0,
            isStationPickup: true,
            stationName: 'Ikeja Shop',
            stationAddress: '1 Allen Avenue',
          })
        ),
    });
    const input = placeInput({
      request: {
        ...checkoutPlaceRequest,
        delivery: {
          displayName: 'Ikeja pickup',
          priceMajor: 0,
          pickup: true,
          pickupLocation: 'Ikeja Shop · 1 Allen Avenue',
        },
      },
    });

    await handleChatwootCheckoutPlace(input);

    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({
      delivery_method: 'pickup_station',
      shipping_rate_id: 'pickup-1',
      shipping_fee: 0,
      shipping_address: {
        address: 'Ikeja Shop, 1 Allen Avenue',
        state: 'Lagos',
      },
    });
    expect(lastResult(input)).toMatchObject({ status: 'payment_ready' });
  });

  it('does not post to a frame that is no longer current', async () => {
    stubCheckoutFetch(happyHandlers());
    const input = placeInput({ canPost: () => false });

    await handleChatwootCheckoutPlace(input);

    expect(input.postResult).not.toHaveBeenCalled();
  });
});

it('places an Oxygen staging order and returns its secure handoff without starting bank transfer', async () => {
  const { calls } = stubCheckoutFetch({
    ...happyHandlers(),
    '/api/orders': () => ({
      body: {
        order: {
          id: '60000000-0000-4000-8000-000000000001',
          order_number: 'ORD-1001',
          currency: 'NGN',
        },
        amountDueToGateway: 4650,
      },
    }),
  });
  const input = placeInput({
    request: { ...checkoutPlaceRequest, paymentMethod: 'oxygen' },
  });
  await handleChatwootCheckoutPlace(input);
  expect(paths(calls)).toEqual(['/api/shipping/quotes', '/api/orders']);
  expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({
    payment_method: 'oxygen',
  });
  expect(lastResult(input)).toEqual({
    requestId: 'place-request-1',
    status: 'secure_handoff',
    href: '/payments/oxygen/60000000-0000-4000-8000-000000000001',
  });
});

it.each([
  'guest',
  'different customer',
  'outside staging',
])('refuses Oxygen before placing an order for %s', async (scenario) => {
  const { calls } = stubCheckoutFetch(happyHandlers());
  if (scenario === 'outside staging') mocks.staging.mockReturnValue(false);
  else
    mocks.user.mockResolvedValue({
      data: {
        user: scenario === 'guest' ? null : { email: 'other@example.com' },
      },
      error: null,
    });
  const input = placeInput({
    request: { ...checkoutPlaceRequest, paymentMethod: 'oxygen' },
  });
  await handleChatwootCheckoutPlace(input);
  expect(calls).toEqual([]);
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(lastResult(input)).toMatchObject({
    status: 'failed',
    code: 'payment_unavailable',
  });
});

it('refuses a cross-method replay on the same cart with order_failed', async () => {
  stubCheckoutFetch({
    ...happyHandlers(),
    '/api/orders': () => ({
      body: {
        order: {
          id: '60000000-0000-4000-8000-000000000001',
          order_number: 'ORD-1002',
        },
        amountDueToGateway: 4650,
      },
    }),
  });
  const first = placeInput({
    request: { ...checkoutPlaceRequest, paymentMethod: 'oxygen' },
  });
  await handleChatwootCheckoutPlace(first);
  expect(lastResult(first)).toMatchObject({ status: 'secure_handoff' });

  const replay = placeInput({
    request: {
      ...checkoutPlaceRequest,
      requestId: 'place-request-2',
      paymentMethod: 'bank_transfer',
    },
  });
  await handleChatwootCheckoutPlace(replay);
  expect(lastResult(replay)).toEqual({
    requestId: 'place-request-2',
    status: 'failed',
    code: 'order_failed',
  });
});

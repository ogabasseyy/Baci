import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECKOUT_QUOTE_TIMEOUT_MS,
  invalidatePendingQuoteRequests,
  loadCheckoutShippingQuotes,
} from './checkout-shipping-quote-loader';

const receiver = {
  address: '1 Airport Road',
  city: 'Port Harcourt',
  deliveryPreference: 'door' as const,
  email: 'customer@example.com',
  fName: 'Ada',
  lName: 'Lovelace',
  latitude: 4.8156,
  longitude: 7.0498,
  phone: '08012345678',
  state: 'Rivers',
  country: 'Nigeria',
  countryCode: 'NG',
  cartSubtotal: 500_000,
};
const cart = [
  { name: 'iPhone 13', negotiatedPrice: 0, price: 500_000, quantity: 1 },
];

function quoteResponse(id = 'road-quote') {
  return new Response(
    JSON.stringify({
      quotes: {
        all: [
          {
            carrierName: 'GIG Logistics',
            currency: 'NGN',
            displayName: 'GIG Logistics - Home Delivery',
            estimatedDays: 3,
            id,
            insuranceIncluded: true,
            pickupIncluded: true,
            price: 5659,
            provider: 'GIGL',
            serviceTier: 'Standard',
          },
        ],
      },
    }),
    { status: 200 }
  );
}

function createState() {
  return {
    activeAbortController: { current: null as AbortController | null },
    currentRequestKey: '',
    force: false,
    requestSequence: { current: 0 },
    setIsLoadingQuotes: vi.fn(),
    setResolvedQuoteRequestKey: vi.fn(),
    setSelectedQuoteId: vi.fn(),
    setShippingQuotes: vi.fn(),
  };
}

describe('loadCheckoutShippingQuotes', () => {
  it.each([
    { address: 'Ikeja, Lagos, Nigeria', expectedCalls: 0 },
    { address: '2 Olaide Tomori Street', expectedCalls: 1 },
  ])('checks a Nigerian street before loading rates: $address', async ({ address, expectedCalls }) => {
    const state = createState();
    await loadCheckoutShippingQuotes({ ...receiver, address, city: 'Ikeja', state: 'Lagos', country: 'Nigeria' }, cart, state);
    expect(global.fetch).toHaveBeenCalledTimes(expectedCalls);
  });

  it.each([
    '',
    '   ',
    'Port Harcourt, Rivers',
  ])('does not calculate delivery for an unset street (%s)', async (address) => {
    const state = createState();
    await loadCheckoutShippingQuotes({ ...receiver, address }, cart, state);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(state.setShippingQuotes).toHaveBeenCalledWith([]);
    expect(state.setSelectedQuoteId).toHaveBeenCalledWith('');
  });

  describe('bugfix: allow streetless pickup quotes through the loader', () => {
    it('fetches pickup_station quotes with city/state when street is empty', async () => {
      const state = createState();
      await loadCheckoutShippingQuotes(
        {
          ...receiver,
          address: '',
          city: 'Ikeja',
          state: 'Lagos',
          deliveryPreference: 'pickup_station',
        },
        cart,
        state,
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(
        String(vi.mocked(global.fetch).mock.calls[0]?.[1]?.body),
      );
      expect(body.deliveryPreference).toBe('pickup_station');
      expect(body.receiver.address).toBe('Ikeja, Lagos');
      expect(body.receiver.city).toBe('Ikeja');
      expect(body.receiver.state).toBe('Lagos');
    });
  });

  describe('bugfix: restore the chosen shipping service after refresh', () => {
    it('keeps a previously selected door quote when it is still in the response', async () => {
      const state = {
        ...createState(),
        preferredSelectedQuoteId: 'door-quote-2',
      };
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            quotes: {
              all: [
                {
                  carrierName: 'GIG Logistics',
                  currency: 'NGN',
                  displayName: 'Standard',
                  estimatedDays: 3,
                  id: 'door-quote-1',
                  insuranceIncluded: true,
                  pickupIncluded: true,
                  price: 2000,
                  provider: 'GIGL',
                  serviceTier: 'Standard',
                },
                {
                  carrierName: 'GIG Logistics',
                  currency: 'NGN',
                  displayName: 'Express',
                  estimatedDays: 1,
                  id: 'door-quote-2',
                  insuranceIncluded: true,
                  pickupIncluded: true,
                  price: 4000,
                  provider: 'GIGL',
                  serviceTier: 'Express',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );
      await loadCheckoutShippingQuotes(receiver, cart, state);
      expect(state.setSelectedQuoteId).toHaveBeenCalledWith('door-quote-2');
    });
  });

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(quoteResponse());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads quotes when AbortSignal static timeout helpers are unavailable', async () => {
    const nativeAbortSignal = AbortSignal;
    vi.stubGlobal('AbortSignal', {});
    const state = createState();

    await loadCheckoutShippingQuotes(receiver, cart, state);

    const signal = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
      ?.signal;
    expect(signal).toBeInstanceOf(nativeAbortSignal);
    expect(state.setShippingQuotes).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'road-quote' }),
    ]);
  });

  it('aborts and clears quotes when the request timeout expires', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    global.fetch = vi.fn((_url, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    });
    const state = createState();

    const request = loadCheckoutShippingQuotes(receiver, cart, state);
    await vi.advanceTimersByTimeAsync(CHECKOUT_QUOTE_TIMEOUT_MS);
    await request;

    expect(warn).toHaveBeenCalledWith('Shipping quote request timed out');
    expect(state.setShippingQuotes).toHaveBeenCalledWith([]);
    expect(state.setIsLoadingQuotes).toHaveBeenLastCalledWith(false);
  });

  it('skips a resolved request unless the caller explicitly retries', async () => {
    const state = createState();

    await loadCheckoutShippingQuotes(receiver, cart, state);
    const resolvedKey = state.setResolvedQuoteRequestKey.mock.calls[0]?.[0];
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(state.setShippingQuotes).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'road-quote' }),
    ]);
    expect(state.setSelectedQuoteId).toHaveBeenLastCalledWith('road-quote');
    const requestBody = JSON.parse(
      String(
        (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body ??
          '{}'
      )
    );
    const requestHeaders = new Headers(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.headers
    );
    expect(requestHeaders.get('x-baci-client')).toBe('web-storefront');
    expect(requestBody).toMatchObject({
      deliveryPreference: 'door',
      items: [expect.objectContaining({ value: 0 })],
      // Merchant-country + subtotal + opt-in flag must reach the quotes body so
      // non-NG merchants match their own zones and merchant rates are returned.
      cart_subtotal: 500_000,
      supports_merchant_rates: true,
      receiver: {
        latitude: 4.8156,
        longitude: 7.0498,
        country: 'Nigeria',
        countryCode: 'NG',
      },
    });

    await loadCheckoutShippingQuotes(receiver, cart, {
      ...state,
      currentRequestKey: resolvedKey,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await loadCheckoutShippingQuotes(receiver, cart, {
      ...state,
      currentRequestKey: resolvedKey,
      force: true,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('refetches when the merchant context changes', async () => {
    const state = createState();
    await loadCheckoutShippingQuotes(
      { ...receiver, merchantId: 'merchant-1' },
      cart,
      state
    );
    const resolvedKey = state.setResolvedQuoteRequestKey.mock.calls[0]?.[0];

    await loadCheckoutShippingQuotes(
      { ...receiver, merchantId: 'merchant-2' },
      cart,
      { ...state, currentRequestKey: resolvedKey }
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'non-successful response',
      () => Promise.resolve(new Response('bad', { status: 503 })),
    ],
    ['network failure', () => Promise.reject(new Error('offline'))],
  ])('clears stale quotes after a %s', async (_label, fetchResult) => {
    global.fetch = vi.fn(fetchResult);
    const state = createState();

    await loadCheckoutShippingQuotes(receiver, cart, state);

    expect(state.setShippingQuotes).toHaveBeenCalledWith([]);
    expect(state.setResolvedQuoteRequestKey).toHaveBeenCalledWith('');
    expect(state.setSelectedQuoteId).toHaveBeenLastCalledWith('');
    expect(state.setIsLoadingQuotes).toHaveBeenLastCalledWith(false);
  });

  it('does not fetch until the receiver location is complete', async () => {
    const state = createState();

    await loadCheckoutShippingQuotes({ ...receiver, city: '' }, cart, state);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(state.setIsLoadingQuotes).not.toHaveBeenCalledWith(true);
  });

  it('ignores a stale response when a newer request finishes first', async () => {
    let resolveFirst: (response: Response) => void = () => undefined;
    let resolveSecond: (response: Response) => void = () => undefined;
    global.fetch = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (resolveFirst = resolve))
      )
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (resolveSecond = resolve))
      );
    const state = createState();
    const firstRequest = loadCheckoutShippingQuotes(receiver, cart, state);
    const secondRequest = loadCheckoutShippingQuotes(
      { ...receiver, city: 'Obio-Akpor' },
      cart,
      state
    );
    const firstSignal = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1]?.signal as AbortSignal;
    expect(firstSignal.aborted).toBe(true);

    resolveSecond(quoteResponse('new-quote'));
    await secondRequest;
    resolveFirst(quoteResponse('stale-quote'));
    await firstRequest;

    expect(state.setShippingQuotes).toHaveBeenCalledTimes(1);
    expect(state.setShippingQuotes).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'new-quote' }),
    ]);
  });

  it('ignores a response after the caller invalidates pending requests', async () => {
    let resolveRequest: (response: Response) => void = () => undefined;
    global.fetch = vi.fn(
      () => new Promise<Response>((resolve) => (resolveRequest = resolve))
    );
    const state = createState();
    const pendingRequest = loadCheckoutShippingQuotes(receiver, cart, state);

    invalidatePendingQuoteRequests(
      state.requestSequence,
      state.activeAbortController
    );
    resolveRequest(quoteResponse('stale-quote'));
    await pendingRequest;

    expect(state.setShippingQuotes).not.toHaveBeenCalled();
    expect(state.setSelectedQuoteId).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { UseFormSetValue } from 'react-hook-form';
import type { FetchQuotesArgs } from '@/components/checkout/checkout-shipping.helpers';
import type { ShippingQuote } from '@/components/checkout/types';
import type { ShippingAddressInput } from '@/lib/validation';
import type { CartItem } from '@/stores/cart-store';
import { useCheckoutShipping } from './use-checkout-shipping';

const mockFetchStates = jest.fn<(apiBaseUrl: string) => Promise<string[]>>();
const mockFetchCities =
  jest.fn<
    (
      apiBaseUrl: string,
      state: string,
      signal: AbortSignal
    ) => Promise<string[]>
  >();
const mockFetchShippingQuotes =
  jest.fn<(args: FetchQuotesArgs) => Promise<void>>();

jest.mock('./checkout-shipping-requests', () => ({
  fetchCheckoutShippingCities: (
    apiBaseUrl: string,
    state: string,
    signal: AbortSignal
  ) => mockFetchCities(apiBaseUrl, state, signal),
  fetchCheckoutShippingStates: (apiBaseUrl: string) =>
    mockFetchStates(apiBaseUrl),
}));

jest.mock('@/components/checkout/checkout-shipping.helpers', () => ({
  ...jest.requireActual<
    typeof import('@/components/checkout/checkout-shipping.helpers')
  >('@/components/checkout/checkout-shipping.helpers'),
  fetchShippingQuotes: (args: FetchQuotesArgs) => mockFetchShippingQuotes(args),
}));

const mockSetValue = jest.fn() as jest.MockedFunction<
  UseFormSetValue<ShippingAddressInput>
>;
const setValue: UseFormSetValue<ShippingAddressInput> = mockSetValue;

const cartItem: CartItem = {
  id: 'line-1',
  name: 'iPhone 13',
  price: 500_000,
  product_id: 'product-1',
  quantity: 1,
  slug: 'iphone-13',
};
const items = [cartItem];

type ShippingParams = Parameters<typeof useCheckoutShipping>[0];

function createParams(overrides: Partial<ShippingParams> = {}): ShippingParams {
  return {
    apiBaseUrl: 'https://api.example.com',
    customer: null,
    items,
    setValue,
    watchedAddress: '',
    watchedCity: '',
    watchedEmail: '',
    watchedFirstName: '',
    watchedLastName: '',
    watchedPhone: '',
    watchedState: '',
    ...overrides,
  };
}

function createLocatedParams(
  watchedState: string,
  watchedCity: string
): ShippingParams {
  return createParams({ watchedCity, watchedState });
}

describe('useCheckoutShipping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchStates.mockResolvedValue(['Lagos']);
    mockFetchCities.mockResolvedValue(['Ikeja', 'Yaba']);
    mockFetchShippingQuotes.mockResolvedValue(undefined);
  });

  it('loads shipping states on mount and clears the loading flag', async () => {
    const { result } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: createParams() }
    );

    await waitFor(() =>
      expect(result.current.shippingStates).toEqual(['Lagos'])
    );

    expect(mockFetchStates).toHaveBeenCalledWith('https://api.example.com');
    expect(result.current.isLoadingLocations).toBe(false);
  });

  it('fetches cities when a state is selected and clears them when it is removed', async () => {
    const { rerender, result } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: createParams() }
    );

    rerender(createParams({ watchedState: 'Lagos' }));

    expect(result.current.isLoadingCities).toBe(true);
    await waitFor(() =>
      expect(result.current.shippingCities).toEqual(['Ikeja', 'Yaba'])
    );
    expect(result.current.isLoadingCities).toBe(false);

    rerender(createParams());

    expect(result.current.shippingCities).toEqual([]);
    expect(result.current.isLoadingCities).toBe(false);
    expect(result.current.selectedQuoteId).toBe('');
  });

  it('requests quotes for door delivery once state and city are present', async () => {
    const { rerender } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: createParams() }
    );

    rerender(createParams({ watchedCity: 'Ikeja', watchedState: 'Lagos' }));

    await waitFor(() =>
      expect(mockFetchShippingQuotes).toHaveBeenCalledTimes(1)
    );
    expect(mockFetchShippingQuotes).toHaveBeenCalledWith(
      expect.objectContaining({
        city: 'Ikeja',
        shouldResetSelection: true,
        state: 'Lagos',
      })
    );
  });

  it('clears the locations loading flag when the states fetch fails', async () => {
    mockFetchStates.mockRejectedValue(new Error('states API down'));

    const { result } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: createParams() }
    );

    await waitFor(() => expect(result.current.isLoadingLocations).toBe(false));
    expect(result.current.shippingStates).toEqual([]);
  });

  it('clears cities and the loading flag when the cities fetch fails', async () => {
    mockFetchCities.mockRejectedValue(new Error('cities API down'));

    const { rerender, result } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: createParams() }
    );

    rerender(createParams({ watchedState: 'Lagos' }));

    expect(result.current.isLoadingCities).toBe(true);
    await waitFor(() => expect(result.current.isLoadingCities).toBe(false));
    expect(result.current.shippingCities).toEqual([]);
  });

  it('leaves cities untouched when the cities fetch aborts', async () => {
    const abortError = Object.assign(new Error('Aborted'), {
      name: 'AbortError',
    });
    mockFetchCities.mockImplementation((_apiBaseUrl, _state, signal) => {
      // Simulate the controller being aborted before the request settles.
      Object.defineProperty(signal, 'aborted', { value: true });
      return Promise.reject(abortError);
    });

    const { rerender, result } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: createParams() }
    );

    rerender(createParams({ watchedState: 'Lagos' }));

    await waitFor(() => expect(mockFetchCities).toHaveBeenCalled());
    // Aborted requests must not write empty cities over a pending newer load.
    expect(result.current.shippingCities).toEqual([]);
  });

  it('keeps quotes empty and the hook stable when the quotes fetch fails', async () => {
    // fetchShippingQuotes owns its own error handling: a failed request clears
    // loading and leaves no quotes selected without surfacing quote rows.
    mockFetchShippingQuotes.mockImplementation((args) => {
      args.setIsLoadingQuotes(false);
      args.setShippingQuotes([]);
      args.setSelectedQuoteId('');
      return Promise.resolve();
    });

    const { rerender, result } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: createParams() }
    );

    rerender(createParams({ watchedCity: 'Ikeja', watchedState: 'Lagos' }));

    await waitFor(() =>
      expect(mockFetchShippingQuotes).toHaveBeenCalledTimes(1)
    );
    expect(result.current.shippingQuotes).toEqual([]);
    expect(result.current.selectedQuoteId).toBe('');
    expect(result.current.isLoadingQuotes).toBe(false);
  });

  it('requests pickup-station quotes when switching to pickup delivery', async () => {
    const quote: ShippingQuote = {
      displayName: 'GIGL Standard',
      id: 'quote-1',
      price: 2500,
    };
    mockFetchShippingQuotes.mockImplementation((args) => {
      args.setIsLoadingQuotes(true);
      args.setShippingQuotes([quote]);
      args.setSelectedQuoteId('quote-1');
      args.setResolvedShippingQuoteContextKey(args.quoteContextKey);
      return Promise.resolve();
    });
    const { rerender, result } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: createParams() }
    );

    rerender(createParams({ watchedCity: 'Ikeja', watchedState: 'Lagos' }));
    await waitFor(() => expect(result.current.selectedQuoteId).toBe('quote-1'));

    act(() => {
      result.current.handleSelectDeliveryMethod('pickup_station');
    });

    expect(result.current.deliveryMethod).toBe('pickup_station');
    await waitFor(() =>
      expect(mockFetchShippingQuotes).toHaveBeenLastCalledWith(
        expect.objectContaining({ deliveryPreference: 'pickup_station' })
      )
    );
    expect(result.current.shippingQuotes).toEqual([quote]);
    expect(result.current.selectedQuoteId).toBe('merchant-office-pickup');
  });

  it('falls back to door when the address state no longer supports airport', () => {
    const { rerender, result } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: createLocatedParams('Rivers', 'Port Harcourt') }
    );

    act(() => {
      result.current.handleSelectDeliveryMethod('airport');
    });
    expect(result.current.deliveryMethod).toBe('airport');

    // Switching to Lagos (no airport delivery) must reset the method.
    rerender(createLocatedParams('Lagos', 'Ikeja'));
    expect(result.current.deliveryMethod).toBe('door');
  });

  it('keeps provider pickup selected when the address moves outside Lagos', () => {
    const { rerender, result } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: createLocatedParams('Lagos', 'Ikeja') }
    );

    act(() => {
      result.current.handleSelectDeliveryMethod('pickup_station');
    });
    expect(result.current.deliveryMethod).toBe('pickup_station');

    // Outside Lagos now uses provider pickup stations instead of the free
    // merchant pickup counter, so the selection remains but needs a quote.
    rerender(createLocatedParams('Oyo', 'Ibadan'));
    expect(result.current.deliveryMethod).toBe('pickup_station');
    expect(result.current.requiresShippingQuote).toBe(true);
  });
});

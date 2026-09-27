import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { UseFormSetValue } from 'react-hook-form';
import type { ShippingAddressInput } from '@/lib/validation';
import type { CartItem } from '@/stores/cart-store';
import type { FetchQuotesArgs } from './checkout-shipping.helpers';
import { loadShippingCities } from './checkout-shipping-loaders';
import { useCheckoutShipping } from './use-checkout-shipping';

const mockFetchShippingQuotes =
  jest.fn<(args: FetchQuotesArgs) => Promise<void>>();
const mockedLoadShippingCities = loadShippingCities as jest.MockedFunction<
  typeof loadShippingCities
>;

jest.mock('./checkout-shipping-loaders', () => ({
  loadShippingCities: jest.fn(),
  loadShippingStates: jest.fn(),
}));

jest.mock('./checkout-shipping.helpers', () => ({
  ...jest.requireActual<typeof import('./checkout-shipping.helpers')>(
    './checkout-shipping.helpers'
  ),
  fetchShippingQuotes: (args: FetchQuotesArgs) => mockFetchShippingQuotes(args),
}));

const item: CartItem = {
  id: 'line-1',
  name: 'iPhone 13',
  price: 500_000,
  product_id: 'product-1',
  quantity: 1,
  slug: 'iphone-13',
};
const items = [item];

describe('useCheckoutShipping airport switching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchShippingQuotes.mockImplementation((args) => {
      args.setIsLoadingQuotes(true);
      args.setShippingQuotes([
        {
          displayName: 'GIG Logistics - Home Delivery',
          id: 'road-quote',
          price: 5_659,
          provider: 'GIGL',
        },
      ]);
      args.setSelectedQuoteId('road-quote');
      args.setResolvedShippingQuoteContextKey(args.quoteContextKey);
      args.setIsLoadingQuotes(false);
      return Promise.resolve();
    });
  });

  it('restores a deferred Google city when the carrier city list is unavailable', () => {
    const setValue = jest.fn() as jest.MockedFunction<
      UseFormSetValue<ShippingAddressInput>
    >;
    const { result } = renderHook(() =>
      useCheckoutShipping({
        apiBaseUrl: 'https://api.example.com',
        customer: null,
        items,
        setValue,
        watchedAddress: '',
        watchedCity: '',
        watchedEmail: 'customer@example.com',
        watchedFirstName: 'Ada',
        watchedLastName: 'Lovelace',
        watchedPhone: '08012345678',
        watchedState: 'Lagos',
      })
    );

    act(() => {
      result.current.handleDeliveryAddressSelect(
        {
          city: 'Lagos',
          country: 'Nigeria',
          formattedAddress: '2 Olaide Tomori St, Ikeja, Lagos, Nigeria',
          latitude: 6.6018,
          longitude: 3.3515,
          route: 'Olaide Tomori St',
          state: 'Lagos',
          streetNumber: '2',
          zip: '101233',
        },
        jest.fn()
      );
    });

    const loadParams = mockedLoadShippingCities.mock.calls.at(-1)?.[0];
    expect(loadParams).toBeDefined();
    act(() => loadParams?.onCitiesUnavailable());

    expect(setValue).toHaveBeenLastCalledWith('city', 'Lagos', {
      shouldValidate: true,
    });

    setValue.mockClear();
    act(() => {
      result.current.handleDeliveryAddressSelect(
        {
          city: 'Lagos',
          country: 'Nigeria',
          formattedAddress: '3 Allen Avenue, Ikeja, Lagos, Nigeria',
          latitude: 6.601,
          longitude: 3.351,
          route: 'Allen Avenue',
          state: 'Lagos',
          streetNumber: '3',
          zip: '101233',
        },
        jest.fn()
      );
    });

    expect(setValue).toHaveBeenCalledWith('city', 'Lagos', {
      shouldValidate: true,
    });
  });

  it('reuses resolved road quotes after switching to air and back', async () => {
    const setValue = jest.fn() as jest.MockedFunction<
      UseFormSetValue<ShippingAddressInput>
    >;
    const { result } = renderHook(() =>
      useCheckoutShipping({
        apiBaseUrl: 'https://api.example.com',
        customer: null,
        items,
        setValue,
        watchedAddress: '1 Airport Road, Port Harcourt',
        watchedCity: 'Port Harcourt',
        watchedEmail: 'customer@example.com',
        watchedFirstName: 'Ada',
        watchedLastName: 'Lovelace',
        watchedPhone: '08012345678',
        watchedState: 'Rivers',
      })
    );

    await waitFor(() =>
      expect(result.current.selectedQuoteId).toBe('road-quote')
    );
    expect(mockFetchShippingQuotes).toHaveBeenCalledTimes(1);

    act(() => result.current.handleSelectDeliveryMethod('airport'));
    expect(result.current.shippingQuotes).toHaveLength(1);

    act(() => result.current.handleSelectDeliveryMethod('door'));
    await act(async () => Promise.resolve());

    expect(result.current.selectedQuoteId).toBe('road-quote');
    expect(result.current.shippingQuotes).toHaveLength(1);
    expect(mockFetchShippingQuotes).toHaveBeenCalledTimes(1);
  });

  it('keeps the initial quote request alive when switching to air', async () => {
    let resolveQuotes: (() => void) | undefined;
    mockFetchShippingQuotes.mockImplementation(
      (args) =>
        new Promise<void>((resolve) => {
          resolveQuotes = () => {
            args.setShippingQuotes([
              {
                displayName: 'GIG Logistics - GoFaster',
                id: 'air-quote',
                price: 18_500,
                provider: 'GIGL',
                serviceTier: 'GoFaster',
              },
            ]);
            args.setResolvedShippingQuoteContextKey(args.quoteContextKey);
            resolve();
          };
        })
    );
    const setValue = jest.fn() as jest.MockedFunction<
      UseFormSetValue<ShippingAddressInput>
    >;
    const { result } = renderHook(() =>
      useCheckoutShipping({
        apiBaseUrl: 'https://api.example.com',
        customer: null,
        items,
        setValue,
        watchedAddress: '1 Airport Road, Port Harcourt',
        watchedCity: 'Port Harcourt',
        watchedEmail: 'customer@example.com',
        watchedFirstName: 'Ada',
        watchedLastName: 'Lovelace',
        watchedPhone: '08012345678',
        watchedState: 'Rivers',
      })
    );

    await waitFor(() =>
      expect(mockFetchShippingQuotes).toHaveBeenCalledTimes(1)
    );
    const requestSignal = mockFetchShippingQuotes.mock.calls[0]?.[0].signal;

    act(() => result.current.handleSelectDeliveryMethod('airport'));

    expect(requestSignal?.aborted).toBe(false);
    expect(mockFetchShippingQuotes).toHaveBeenCalledTimes(1);

    await act(async () => resolveQuotes?.());

    expect(result.current.shippingQuotes).toEqual([
      expect.objectContaining({ id: 'air-quote', serviceTier: 'GoFaster' }),
    ]);
  });

  it('falls back to door for same-city Lagos even with a GIGL GoFaster quote', async () => {
    mockFetchShippingQuotes.mockImplementation((args) => {
      args.setShippingQuotes([
        {
          displayName: 'GIG Logistics - GoStandard',
          id: 'road-quote',
          price: 3500,
          provider: 'GIGL',
        },
        {
          displayName: 'GIG Logistics - GoFaster',
          id: 'air-quote',
          price: 3500,
          provider: 'GIGL',
          serviceTier: 'GoFaster',
        },
      ]);
      args.setSelectedQuoteId('road-quote');
      args.setResolvedShippingQuoteContextKey(args.quoteContextKey);
      return Promise.resolve();
    });
    const setValue = jest.fn() as jest.MockedFunction<
      UseFormSetValue<ShippingAddressInput>
    >;
    const { result } = renderHook(() =>
      useCheckoutShipping({
        apiBaseUrl: 'https://api.example.com',
        customer: null,
        items,
        setValue,
        watchedAddress: '2 Olaide Tomori St, Ikeja, Lagos',
        watchedCity: 'Ikeja',
        watchedEmail: 'customer@example.com',
        watchedFirstName: 'Ada',
        watchedLastName: 'Lovelace',
        watchedPhone: '08012345678',
        watchedState: 'Lagos',
      })
    );

    await waitFor(() =>
      expect(result.current.selectedQuoteId).toBe('road-quote')
    );
    act(() => result.current.handleSelectDeliveryMethod('airport'));

    expect(result.current.deliveryMethod).toBe('door');
  });
});

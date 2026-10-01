import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { UseFormSetValue } from 'react-hook-form';
import type { FetchQuotesArgs } from '@/components/checkout/checkout-shipping.helpers';
import type { PlaceDetails } from '@/components/ui/AddressAutocomplete';
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
const mockSetValue = jest.fn() as jest.MockedFunction<
  UseFormSetValue<ShippingAddressInput>
>;

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

const cartItem: CartItem = {
  id: 'line-1',
  name: 'iPhone 13',
  price: 500_000,
  product_id: 'product-1',
  quantity: 1,
  slug: 'iphone-13',
};

type ShippingParams = Parameters<typeof useCheckoutShipping>[0];

function createParams(overrides: Partial<ShippingParams> = {}): ShippingParams {
  return {
    apiBaseUrl: 'https://api.example.com',
    customer: null,
    items: [cartItem],
    setValue: mockSetValue,
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

function createPlace(overrides: Partial<PlaceDetails> = {}): PlaceDetails {
  return {
    city: 'ikeja',
    country: 'Nigeria',
    formattedAddress: '1 Test Way, Ikeja',
    route: 'Test Way',
    state: 'Lagos',
    streetNumber: '1',
    zip: '',
    ...overrides,
  };
}

describe('useCheckoutShipping Google city resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchStates.mockResolvedValue(['Lagos']);
    mockFetchCities.mockResolvedValue(['Ikeja', 'Yaba']);
    mockFetchShippingQuotes.mockResolvedValue(undefined);
  });

  it('keeps manual location pickers hidden until an address is entered', () => {
    const { rerender, result } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: createParams() }
    );

    expect(result.current.showLocationPickers).toBe(false);

    rerender(createParams({ watchedAddress: '12 Marina Road' }));

    expect(result.current.showLocationPickers).toBe(true);
  });

  it('applies a Google-suggested city once the matching city list loads', async () => {
    const updateAddress = jest.fn();
    const { rerender, result } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: createParams() }
    );
    await waitFor(() =>
      expect(result.current.shippingStates).toEqual(['Lagos'])
    );

    act(() => {
      result.current.handleDeliveryAddressSelect(createPlace(), updateAddress);
    });
    rerender(createParams({ watchedState: 'Lagos' }));

    expect(updateAddress).toHaveBeenCalledWith('1 Test Way, Ikeja');
    await waitFor(() =>
      expect(mockSetValue).toHaveBeenCalledWith('city', 'Ikeja', {
        shouldValidate: true,
      })
    );
  });

  it('hides manual location pickers after a complete Google location is selected', async () => {
    const updateAddress = jest.fn();
    const { rerender, result } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: createParams() }
    );
    await waitFor(() =>
      expect(result.current.shippingStates).toEqual(['Lagos'])
    );

    act(() => {
      result.current.handleDeliveryAddressSelect(
        createPlace({ latitude: 6.6018, longitude: 3.3515 }),
        updateAddress
      );
    });
    rerender(
      createParams({
        watchedAddress: '1 Test Way, Ikeja',
        watchedCity: 'Ikeja',
        watchedState: 'Lagos',
      })
    );

    expect(result.current.showLocationPickers).toBe(false);
  });

  it('opens the city picker with a search seed when the suggested city has no match', async () => {
    const { rerender, result } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: createParams() }
    );
    await waitFor(() =>
      expect(result.current.shippingStates).toEqual(['Lagos'])
    );

    act(() => {
      result.current.handleDeliveryAddressSelect(
        createPlace({ city: 'Magodo' }),
        jest.fn()
      );
    });
    rerender(createParams({ watchedState: 'Lagos' }));

    await waitFor(() => expect(result.current.showCityPicker).toBe(true));
    expect(result.current.citySearch).toBe('Magodo');
    expect(mockSetValue).not.toHaveBeenCalledWith('city', 'Magodo', {
      shouldValidate: true,
    });
  });

  it('opens the picker immediately when Google returns the state name as the city', async () => {
    const { result } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      {
        initialProps: createParams({
          watchedCity: 'Ikeja',
          watchedState: 'Lagos',
        }),
      }
    );
    await waitFor(() =>
      expect(result.current.shippingCities).toEqual(['Ikeja', 'Yaba'])
    );

    act(() => {
      result.current.handleDeliveryAddressSelect(
        createPlace({ city: 'Lagos' }),
        jest.fn()
      );
    });

    expect(result.current.showCityPicker).toBe(true);
  });

  it('opens the city picker when Google resolves the state without a city', async () => {
    const { rerender, result } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      {
        initialProps: createParams({
          watchedCity: 'Ikeja',
          watchedState: 'Lagos',
        }),
      }
    );
    await waitFor(() =>
      expect(result.current.shippingCities).toEqual(['Ikeja', 'Yaba'])
    );

    act(() => {
      result.current.handleDeliveryAddressSelect(
        createPlace({ city: '' }),
        jest.fn()
      );
    });
    rerender(
      createParams({
        watchedCity: 'Ikeja',
        watchedState: 'Lagos',
      })
    );

    await waitFor(() => expect(result.current.showCityPicker).toBe(true));
    expect(result.current.citySearch).toBe('');
  });
});

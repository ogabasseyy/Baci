import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
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

describe('manual checkout address quote freshness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchStates.mockResolvedValue(['Lagos']);
    mockFetchCities.mockResolvedValue(['Ikeja']);
  });
  it('refreshes the quote after each manual street edit in the same city', async () => {
    const quote: ShippingQuote = {
      id: 'quote-1',
      displayName: 'GIGL',
      price: 2500,
    };
    mockFetchShippingQuotes.mockImplementation(async (args) => {
      args.setShippingQuotes([quote]);
      args.setSelectedQuoteId(String(quote.id));
      args.setResolvedShippingQuoteContextKey(args.quoteContextKey);
      args.setIsLoadingQuotes(false);
    });
    const params = createParams({
      watchedAddress: '12 First Street',
      watchedCity: 'Ikeja',
      watchedState: 'Lagos',
    });
    const { result, rerender } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: params }
    );
    await waitFor(() => expect(result.current.selectedQuoteId).toBe('quote-1'));
    const originalKey = result.current.currentShippingQuoteContextKey;
    rerender({ ...params, watchedAddress: '14 Second Street' });
    await waitFor(() =>
      expect(mockFetchShippingQuotes).toHaveBeenLastCalledWith(
        expect.objectContaining({
          watchedAddress: '14 Second Street',
          shouldResetSelection: true,
        })
      )
    );
    expect(result.current.currentShippingQuoteContextKey).not.toBe(originalKey);
    rerender({ ...params, watchedAddress: '16 Third Street' });
    await waitFor(() =>
      expect(mockFetchShippingQuotes).toHaveBeenLastCalledWith(
        expect.objectContaining({
          watchedAddress: '16 Third Street',
          shouldResetSelection: true,
        })
      )
    );
  });

  it('keeps pickup quote context stable when filling the quoted locality fallback', async () => {
    mockFetchShippingQuotes.mockImplementation(async (args) => {
      args.setResolvedShippingQuoteContextKey(args.quoteContextKey);
      args.setIsLoadingQuotes(false);
    });
    const params = createParams({
      watchedCity: 'Ikeja',
      watchedState: 'Lagos',
    });
    const { result, rerender } = renderHook(
      (props: ShippingParams) => useCheckoutShipping(props),
      { initialProps: params }
    );
    await waitFor(() =>
      expect(result.current.isCurrentQuoteContext).toBe(true)
    );
    const key = result.current.currentShippingQuoteContextKey;
    rerender({ ...params, watchedAddress: 'Ikeja, Lagos' });
    expect(result.current.currentShippingQuoteContextKey).toBe(key);
    expect(mockFetchShippingQuotes).toHaveBeenCalledTimes(1);
  });
});

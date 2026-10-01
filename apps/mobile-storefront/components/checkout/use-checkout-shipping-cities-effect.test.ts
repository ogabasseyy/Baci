import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { loadShippingCities } from './checkout-shipping-loaders';
import { useCheckoutShippingCitiesEffect } from './use-checkout-shipping-cities-effect';

jest.mock('./checkout-shipping-loaders', () => ({
  loadShippingCities: jest.fn(),
}));

const mockedLoad = loadShippingCities as jest.MockedFunction<
  typeof loadShippingCities
>;

describe('useCheckoutShippingCitiesEffect', () => {
  beforeEach(() => {
    mockedLoad.mockReset();
  });

  it('does not request cities until a state is selected', () => {
    renderHook(() =>
      useCheckoutShippingCitiesEffect({
        apiBaseUrl: 'https://api.example.com',
        onCitiesLoaded: jest.fn(),
        onCitiesUnavailable: jest.fn(),
        setIsLoadingCities: jest.fn(),
        setShippingCities: jest.fn(),
        state: '',
      })
    );

    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it('loads cities for the selected state and aborts on unmount', () => {
    const onCitiesUnavailable = jest.fn();
    const { unmount } = renderHook(() =>
      useCheckoutShippingCitiesEffect({
        apiBaseUrl: 'https://api.example.com',
        onCitiesLoaded: jest.fn(),
        onCitiesUnavailable,
        setIsLoadingCities: jest.fn(),
        setShippingCities: jest.fn(),
        state: 'Lagos',
      })
    );

    expect(mockedLoad).toHaveBeenCalledTimes(1);
    const [{ signal }] = mockedLoad.mock.calls[0];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    expect(mockedLoad.mock.calls[0]?.[0].onCitiesUnavailable).toBeDefined();

    act(() => unmount());
    expect(signal.aborted).toBe(true);
  });
});

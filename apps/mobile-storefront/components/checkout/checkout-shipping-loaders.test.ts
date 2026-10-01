import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  loadShippingCities,
  loadShippingStates,
} from './checkout-shipping-loaders';

const mockFetchStates = jest.fn<(apiBaseUrl: string) => Promise<string[]>>();
const mockFetchCities =
  jest.fn<
    (
      apiBaseUrl: string,
      state: string,
      signal: AbortSignal
    ) => Promise<string[]>
  >();

jest.mock('./checkout-shipping-requests', () => ({
  fetchCheckoutShippingCities: (
    apiBaseUrl: string,
    state: string,
    signal: AbortSignal
  ) => mockFetchCities(apiBaseUrl, state, signal),
  fetchCheckoutShippingStates: (apiBaseUrl: string) =>
    mockFetchStates(apiBaseUrl),
}));

const apiBaseUrl = 'https://api.example.com';

describe('loadShippingStates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets the loading flag, applies states, then clears the flag on success', async () => {
    // Arrange
    mockFetchStates.mockResolvedValue(['Lagos', 'Abuja']);
    const setIsLoadingLocations = jest.fn<(value: boolean) => void>();
    const setShippingStates = jest.fn<(states: string[]) => void>();

    // Act
    await loadShippingStates({
      apiBaseUrl,
      setIsLoadingLocations,
      setShippingStates,
    });

    // Assert
    expect(setIsLoadingLocations).toHaveBeenNthCalledWith(1, true);
    expect(setShippingStates).toHaveBeenCalledWith(['Lagos', 'Abuja']);
    expect(setIsLoadingLocations).toHaveBeenLastCalledWith(false);
  });

  it('clears the loading flag and skips applying states on failure', async () => {
    // Arrange
    mockFetchStates.mockRejectedValue(new Error('states API down'));
    const setIsLoadingLocations = jest.fn<(value: boolean) => void>();
    const setShippingStates = jest.fn<(states: string[]) => void>();

    // Act
    await loadShippingStates({
      apiBaseUrl,
      setIsLoadingLocations,
      setShippingStates,
    });

    // Assert
    expect(setShippingStates).not.toHaveBeenCalled();
    expect(setIsLoadingLocations).toHaveBeenNthCalledWith(1, true);
    expect(setIsLoadingLocations).toHaveBeenLastCalledWith(false);
  });
});

describe('loadShippingCities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('arms the loading flag, applies cities, and notifies the listener on success', async () => {
    // Arrange
    mockFetchCities.mockResolvedValue(['Ikeja', 'Yaba']);
    const setIsLoadingCities = jest.fn<(value: boolean) => void>();
    const setShippingCities = jest.fn<(cities: string[]) => void>();
    const onCitiesLoaded = jest.fn<(cities: string[]) => void>();
    const onCitiesUnavailable = jest.fn<() => void>();
    const signal = new AbortController().signal;

    // Act
    await loadShippingCities({
      apiBaseUrl,
      onCitiesLoaded,
      onCitiesUnavailable,
      setIsLoadingCities,
      setShippingCities,
      signal,
      state: 'Lagos',
    });

    // Assert
    expect(setIsLoadingCities).toHaveBeenNthCalledWith(1, true);
    expect(setShippingCities).toHaveBeenCalledWith(['Ikeja', 'Yaba']);
    expect(onCitiesLoaded).toHaveBeenCalledWith(['Ikeja', 'Yaba']);
    expect(onCitiesUnavailable).not.toHaveBeenCalled();
    expect(setIsLoadingCities).toHaveBeenLastCalledWith(false);
  });

  it('clears cities and the loading flag when the fetch fails', async () => {
    // Arrange
    mockFetchCities.mockRejectedValue(new Error('cities API down'));
    const setIsLoadingCities = jest.fn<(value: boolean) => void>();
    const setShippingCities = jest.fn<(cities: string[]) => void>();
    const onCitiesLoaded = jest.fn<(cities: string[]) => void>();
    const onCitiesUnavailable = jest.fn<() => void>();
    const signal = new AbortController().signal;

    // Act
    await loadShippingCities({
      apiBaseUrl,
      onCitiesLoaded,
      onCitiesUnavailable,
      setIsLoadingCities,
      setShippingCities,
      signal,
      state: 'Lagos',
    });

    // Assert
    expect(setIsLoadingCities).toHaveBeenNthCalledWith(1, true);
    expect(setShippingCities).toHaveBeenLastCalledWith([]);
    expect(onCitiesLoaded).not.toHaveBeenCalled();
    expect(onCitiesUnavailable).toHaveBeenCalledTimes(1);
    expect(setIsLoadingCities).toHaveBeenLastCalledWith(false);
  });

  it('reports an unavailable city list when the provider returns no cities', async () => {
    mockFetchCities.mockResolvedValue([]);
    const setIsLoadingCities = jest.fn<(value: boolean) => void>();
    const setShippingCities = jest.fn<(cities: string[]) => void>();
    const onCitiesLoaded = jest.fn<(cities: string[]) => void>();
    const onCitiesUnavailable = jest.fn<() => void>();

    await loadShippingCities({
      apiBaseUrl,
      onCitiesLoaded,
      onCitiesUnavailable,
      setIsLoadingCities,
      setShippingCities,
      signal: new AbortController().signal,
      state: 'Lagos',
    });

    expect(setShippingCities).toHaveBeenCalledWith([]);
    expect(onCitiesLoaded).not.toHaveBeenCalled();
    expect(onCitiesUnavailable).toHaveBeenCalledTimes(1);
  });

  it('does not mutate state for an already-aborted request', async () => {
    // Arrange
    mockFetchCities.mockRejectedValue(new Error('aborted'));
    const controller = new AbortController();
    controller.abort();
    const setIsLoadingCities = jest.fn<(value: boolean) => void>();
    const setShippingCities = jest.fn<(cities: string[]) => void>();
    const onCitiesLoaded = jest.fn<(cities: string[]) => void>();
    const onCitiesUnavailable = jest.fn<() => void>();

    // Act
    await loadShippingCities({
      apiBaseUrl,
      onCitiesLoaded,
      onCitiesUnavailable,
      setIsLoadingCities,
      setShippingCities,
      signal: controller.signal,
      state: 'Lagos',
    });

    // Assert
    expect(setIsLoadingCities).not.toHaveBeenCalled();
    expect(setShippingCities).not.toHaveBeenCalled();
    expect(onCitiesLoaded).not.toHaveBeenCalled();
    expect(onCitiesUnavailable).not.toHaveBeenCalled();
  });
});

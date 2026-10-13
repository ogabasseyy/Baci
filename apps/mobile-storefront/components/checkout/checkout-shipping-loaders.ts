import {
  fetchCheckoutShippingCities,
  fetchCheckoutShippingStates,
} from './checkout-shipping-requests';

// Module-scope helpers own the try/finally finalizers: React Compiler cannot
// yet lower try/finally inside a hook body, which disabled memoization for the
// whole hook.
export async function loadShippingStates(params: {
  apiBaseUrl: string;
  setIsLoadingLocations: (value: boolean) => void;
  setShippingStates: (states: string[]) => void;
}) {
  const { apiBaseUrl, setIsLoadingLocations, setShippingStates } = params;
  setIsLoadingLocations(true);
  try {
    setShippingStates(await fetchCheckoutShippingStates(apiBaseUrl));
  } catch {
    // Shipping locations are optional until the customer enters an address.
  } finally {
    setIsLoadingLocations(false);
  }
}

export async function loadShippingCities(params: {
  apiBaseUrl: string;
  onCitiesLoaded: (cities: string[]) => void;
  onCitiesUnavailable: () => void;
  setIsLoadingCities: (value: boolean) => void;
  setShippingCities: (cities: string[]) => void;
  signal: AbortSignal;
  state: string;
}) {
  const {
    apiBaseUrl,
    onCitiesLoaded,
    onCitiesUnavailable,
    setIsLoadingCities,
    setShippingCities,
    signal,
    state,
  } = params;
  // Mirror loadShippingStates' self-contained contract: own the loading flag
  // instead of relying on the caller's render-time pre-set.
  if (!signal.aborted) setIsLoadingCities(true);
  try {
    const cities = await fetchCheckoutShippingCities(apiBaseUrl, state, signal);
    if (!signal.aborted) {
      setShippingCities(cities);
      if (cities.length > 0) onCitiesLoaded(cities);
      else onCitiesUnavailable();
    }
  } catch {
    if (!signal.aborted) {
      setShippingCities([]);
      onCitiesUnavailable();
    }
  } finally {
    if (!signal.aborted) setIsLoadingCities(false);
  }
}

import { useEffect, useRef, useState } from 'react';
import type { CountryCode } from 'react-native-country-picker-modal';
import {
  type AddressSuggestion,
  assertGoogleAutocompleteResponse,
  buildGoogleAutocompleteUrl,
  type GoogleAutocompleteResponse,
  toAddressSuggestions,
} from './new-customer-address-autocomplete';

export function useNewCustomerAddressSuggestions({
  address,
  googleMapsApiKey,
  hasGoogleMapsApiKey,
  isFocused,
  selectedCountryCode,
}: {
  address: string;
  googleMapsApiKey: string | undefined;
  hasGoogleMapsApiKey: boolean;
  isFocused: boolean;
  selectedCountryCode: CountryCode;
}) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    if (!(hasGoogleMapsApiKey && googleMapsApiKey) || !isFocused) {
      requestSequenceRef.current += 1;
      setSuggestions([]);
      return;
    }
    const trimmedAddress = address.trim();
    if (trimmedAddress.length < 2) {
      requestSequenceRef.current += 1;
      setSuggestions([]);
      return;
    }
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      fetch(
        buildGoogleAutocompleteUrl({
          googleMapsApiKey,
          input: trimmedAddress,
          selectedCountryCode,
        }),
        { signal: abortController.signal }
      )
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Google Places returned ${response.status}`);
          }
          const data = (await response.json()) as GoogleAutocompleteResponse;
          assertGoogleAutocompleteResponse(data);
          return data;
        })
        .then((data) => {
          if (requestSequenceRef.current !== requestSequence) return;
          setSuggestions(toAddressSuggestions(data));
        })
        .catch((error: unknown) => {
          if (requestSequenceRef.current !== requestSequence) return;
          if (
            typeof __DEV__ !== 'undefined' &&
            __DEV__ &&
            !(
              error instanceof Error &&
              error.name.toLowerCase() === 'aborterror'
            )
          ) {
            console.warn('[NewCustomerAddressInput] Places lookup failed', {
              error,
            });
          }
          setSuggestions([]);
        });
    }, 300);
    return () => {
      clearTimeout(timeout);
      abortController.abort();
      requestSequenceRef.current += 1;
    };
  }, [
    address,
    googleMapsApiKey,
    hasGoogleMapsApiKey,
    isFocused,
    selectedCountryCode,
  ]);

  return { requestSequenceRef, setSuggestions, suggestions };
}

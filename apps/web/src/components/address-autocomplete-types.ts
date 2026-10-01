import type React from 'react';

export interface PlaceDetails {
  streetNumber: string;
  route: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  formattedAddress: string;
  location?: { latitude: number; longitude: number } | null;
}

export interface AddressAutocompleteProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'onSelect' | 'onError'
  > {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement> | string) => void;
  onSelect?: (place: PlaceDetails) => void;
  useThemedInput?: boolean;
  showIcon?: boolean;
  country?: string;
  /** Reports failed suggestions so callers can offer manual address entry. */
  onError?: (failed: boolean) => void;
}

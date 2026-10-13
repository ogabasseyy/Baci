import { useRef } from 'react';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { useTheme } from '@/hooks/useTheme';
import { parseGoogleAddressDetails } from './google-address-details';

export function CheckoutRecoveryAddressInput({
  onSelect,
  onSearchChange,
  address,
  disabled = false,
}: {
  onSearchChange: (text: string) => void;
  address: string;
  disabled?: boolean;
  onSelect: (destination: {
    address: string;
    city: string;
    state: string;
    latitude: string;
    longitude: string;
  }) => void;
}) {
  const { colors } = useTheme();
  const selectedDescription = useRef<string | null>(null);
  const isDisabled = useRef(disabled);
  isDisabled.current = disabled;
  const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  return (
    <GooglePlacesAutocomplete
      placeholder="Search confirmed destination"
      fetchDetails
      keyboardShouldPersistTaps="handled"
      enablePoweredByContainer={false}
      query={{ key, language: 'en' }}
      listViewDisplayed={disabled ? false : 'auto'}
      textInputProps={{
        accessibilityLabel: 'Search confirmed delivery destination',
        editable: !disabled,
        onChangeText: (text) => {
          if (
            isDisabled.current ||
            (text === selectedDescription.current && text === address)
          )
            return;
          selectedDescription.current = null;
          onSearchChange(text);
        },
      }}
      styles={{
        container: { flex: 0 },
        textInput: {
          color: colors.text,
          backgroundColor: colors.backgroundLight,
        },
      }}
      onPress={(data, details) => {
        if (isDisabled.current) return;
        selectedDescription.current = data.description;
        const parsed = details ? parseGoogleAddressDetails(details) : null;
        onSelect({
          address: data.description,
          city: parsed?.city ?? '',
          state: parsed?.state ?? '',
          latitude: parsed?.latitude?.toString() ?? '',
          longitude: parsed?.longitude?.toString() ?? '',
        });
      }}
    />
  );
}

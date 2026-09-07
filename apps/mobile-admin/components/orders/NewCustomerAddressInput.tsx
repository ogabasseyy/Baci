import Ionicons from '@react-native-vector-icons/ionicons';
import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Text, View } from 'react-native';
import type { CountryCode } from 'react-native-country-picker-modal';
import { SheetTextInput } from '@/components/ui/SheetTextInput';
import type { ThemeColors } from '@/constants/theme';
import { fetchGoogleAddressDetails } from './google-address-details';
import { NewCustomerAddressDetailsRecovery } from './NewCustomerAddressDetailsRecovery';
import { NewCustomerAddressSuggestions } from './NewCustomerAddressSuggestions';
import { NewCustomerManualAddressFallback } from './NewCustomerManualAddressFallback';
import { customerCreateStyles as customerStyles } from './NewOrderCustomerCreateView.styles';
import type { AddressSuggestion } from './new-customer-address-autocomplete';
import type { NewCustomerDraft } from './new-order.types';
import { useNewCustomerAddressSuggestions } from './useNewCustomerAddressSuggestions';

interface NewCustomerAddressInputProps {
  address: string;
  city?: string;
  colors: ThemeColors;
  googleMapsApiKey: string | undefined;
  onAddressBlur?: () => void;
  onAddressDetailsPendingChange?: (pending: boolean) => void;
  onAddressFocus?: () => void;
  selectedCountryCode: CountryCode;
  setNewCustomer: Dispatch<SetStateAction<NewCustomerDraft>>;
  state?: string;
}

const DETAILS_RECOVERY_ERROR =
  'Could not load full address details. Enter city and state to continue.';

export function NewCustomerAddressInput({
  address,
  city = '',
  colors,
  googleMapsApiKey,
  onAddressBlur,
  onAddressDetailsPendingChange,
  onAddressFocus,
  selectedCountryCode,
  setNewCustomer,
  state = '',
}: NewCustomerAddressInputProps) {
  const hasGoogleMapsApiKey = Boolean(googleMapsApiKey);
  const [isFocused, setIsFocused] = useState(false);
  const [detailsRecovery, setDetailsRecovery] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionSequenceRef = useRef(0);
  const { requestSequenceRef, setSuggestions, suggestions } =
    useNewCustomerAddressSuggestions({
      address,
      googleMapsApiKey,
      hasGoogleMapsApiKey,
      isFocused,
      selectedCountryCode,
    });

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
      // Invalidate in-flight place-details callbacks so unmount cannot repopulate
      // the next customer draft after resetNewCustomerForm.
      selectionSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!detailsRecovery) return;
    onAddressDetailsPendingChange?.(!(city.trim() && state.trim()));
  }, [city, detailsRecovery, onAddressDetailsPendingChange, state]);

  const handleAddressChange = (text: string) => {
    selectionSequenceRef.current += 1;
    setDetailsRecovery(false);
    setDetailsError(null);
    onAddressDetailsPendingChange?.(false);
    if (!hasGoogleMapsApiKey) {
      setNewCustomer((previous) => ({
        ...previous,
        address: text,
        latitude: undefined,
        longitude: undefined,
      }));
      return;
    }
    setNewCustomer((previous) => ({
      ...previous,
      address: text,
      city: '',
      state: '',
      country: '',
      countryCode: '',
      postalCode: '',
      latitude: undefined,
      longitude: undefined,
    }));
  };

  // Recovery edits must keep the locality gate active until city+state are set.
  const handleRecoveryAddressChange = (text: string) => {
    setNewCustomer((previous) => ({
      ...previous,
      address: text,
      latitude: undefined,
      longitude: undefined,
    }));
  };

  const beginDetailsRecovery = () => {
    setDetailsError(DETAILS_RECOVERY_ERROR);
    setDetailsRecovery(true);
    onAddressDetailsPendingChange?.(true);
  };

  const handleSuggestionPress = (suggestion: AddressSuggestion) => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    requestSequenceRef.current += 1;
    setSuggestions([]);
    setIsFocused(false);
    Keyboard.dismiss();
    const selectionSequence = selectionSequenceRef.current + 1;
    selectionSequenceRef.current = selectionSequence;
    setDetailsRecovery(false);
    setDetailsError(null);
    setNewCustomer((previous) => ({
      ...previous,
      address: suggestion.description,
      city: '',
      state: '',
      country: '',
      countryCode: '',
      postalCode: '',
      latitude: undefined,
      longitude: undefined,
    }));
    if (googleMapsApiKey && suggestion.placeId) {
      onAddressDetailsPendingChange?.(true);
      fetchGoogleAddressDetails({
        googleMapsApiKey,
        placeId: suggestion.placeId,
      })
        .then((details) => {
          if (selectionSequenceRef.current !== selectionSequence) return;
          if (details) {
            setNewCustomer((previous) => ({ ...previous, ...details }));
            const missingLocality = !(
              details.city.trim() && details.state.trim()
            );
            if (missingLocality) {
              beginDetailsRecovery();
              return;
            }
            onAddressDetailsPendingChange?.(false);
            return;
          }
          beginDetailsRecovery();
        })
        .catch(() => {
          if (selectionSequenceRef.current === selectionSequence) {
            beginDetailsRecovery();
          }
        });
    } else {
      beginDetailsRecovery();
    }
    onAddressBlur?.();
  };

  return (
    <View style={[customerStyles.section, { zIndex: 10 }]}>
      <View style={customerStyles.sectionHeader}>
        <View
          style={[
            customerStyles.sectionIcon,
            { backgroundColor: colors.errorLight },
          ]}
        >
          <Ionicons color={colors.error} name="location-outline" size={17} />
        </View>
        <Text style={[customerStyles.sectionTitle, { color: colors.text }]}>
          Address
        </Text>
      </View>
      {hasGoogleMapsApiKey ? (
        <View>
          <Ionicons
            color={colors.error}
            name="map-outline"
            size={18}
            style={customerStyles.addressIcon}
          />
          <SheetTextInput
            accessibilityLabel="Customer address"
            onBlur={() => {
              blurTimerRef.current = setTimeout(() => {
                requestSequenceRef.current += 1;
                setIsFocused(false);
                setSuggestions([]);
                onAddressBlur?.();
              }, 150);
            }}
            onChangeText={handleAddressChange}
            onFocus={() => {
              if (blurTimerRef.current) {
                clearTimeout(blurTimerRef.current);
                blurTimerRef.current = null;
              }
              setIsFocused(true);
              onAddressFocus?.();
            }}
            placeholder="Search Address"
            placeholderTextColor={colors.textMuted}
            style={[
              customerStyles.fieldInput,
              {
                backgroundColor: colors.inputBg,
                borderColor: colors.border,
                borderRadius: 12,
                borderWidth: 1,
                color: colors.text,
                fontSize: 16,
                minHeight: 54,
                paddingLeft: 44,
                paddingRight: 16,
              },
            ]}
            value={address}
          />
          {isFocused ? (
            <NewCustomerAddressSuggestions
              colors={colors}
              onSelect={handleSuggestionPress}
              suggestions={suggestions}
            />
          ) : null}
          {detailsRecovery && detailsError ? (
            <NewCustomerAddressDetailsRecovery
              address={address}
              city={city}
              colors={colors}
              error={detailsError}
              onAddressChange={handleRecoveryAddressChange}
              setNewCustomer={setNewCustomer}
              state={state}
            />
          ) : null}
        </View>
      ) : (
        <NewCustomerManualAddressFallback
          address={address}
          city={city}
          colors={colors}
          onAddressChange={handleAddressChange}
          setNewCustomer={setNewCustomer}
          state={state}
        />
      )}
    </View>
  );
}

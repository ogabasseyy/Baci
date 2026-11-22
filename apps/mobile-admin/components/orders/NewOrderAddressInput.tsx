import { useLayoutEffect, useRef, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import type { useNewOrderController } from '@/hooks/useNewOrderController';
import { parseGoogleAddressDetails } from './google-address-details';
import { NewOrderManualLocalityFields } from './NewOrderManualLocalityFields';
import { styles } from './new-order.styles';
import {
  clearGeocodedFields,
  isFormattingOnlyStreetEdit,
} from './new-order-address-input-utils';

interface NewOrderAddressInputProps {
  controller: Pick<
    ReturnType<typeof useNewOrderController>,
    'colors' | 'deliveryInfo' | 'setDeliveryInfo'
  >;
  googleMapsApiKey: string | undefined;
}

const DETAILS_RECOVERY_ERROR =
  'Could not load full address details. Enter city and state to continue.';

export function NewOrderAddressInput({
  controller,
  googleMapsApiKey,
}: NewOrderAddressInputProps) {
  const { colors, deliveryInfo, setDeliveryInfo } = controller;
  const hasGoogleMapsApiKey = Boolean(googleMapsApiKey);
  const selectedDescriptionRef = useRef<string | null>(null);
  const latestStreetRef = useRef(deliveryInfo.address);
  const latestLocalityRef = useRef({
    city: deliveryInfo.city,
    state: deliveryInfo.state,
  });
  const [detailsRecovery, setDetailsRecovery] = useState(false);
  const [manualLocality, setManualLocality] = useState(false);

  useLayoutEffect(() => {
    latestStreetRef.current = deliveryInfo.address;
  }, [deliveryInfo.address]);

  useLayoutEffect(() => {
    latestLocalityRef.current = {
      city: deliveryInfo.city,
      state: deliveryInfo.state,
    };
  }, [deliveryInfo.city, deliveryInfo.state]);

  const setLocality = (field: 'city' | 'state', text: string) => {
    const previousText = latestLocalityRef.current[field];
    if (previousText.trim().toLowerCase() !== text.trim().toLowerCase()) {
      // Keep the confirmation visible after reverting: the original pin was
      // invalidated by the first edit and typing back cannot restore it.
      setManualLocality(true);
    }
    latestLocalityRef.current[field] = text;
    setDeliveryInfo((previous) => {
      if (previous[field].trim().toLowerCase() === text.trim().toLowerCase()) {
        return { ...previous, [field]: text };
      }
      return {
        ...previous,
        [field]: text,
        latitude: undefined,
        longitude: undefined,
      };
    });
  };

  return (
    <View style={{ zIndex: 5 }}>
      <Text
        style={[styles.label, { color: colors.textSecondary, marginBottom: 4 }]}
      >
        Delivery Address
      </Text>
      {hasGoogleMapsApiKey ? (
        <>
          <GooglePlacesAutocomplete
            debounce={300}
            enablePoweredByContainer={false}
            fetchDetails
            keyboardShouldPersistTaps="handled"
            listViewDisplayed="auto"
            nearbyPlacesAPI="GooglePlacesSearch"
            onFail={(error) => {
              if (__DEV__) {
                console.log('Google Places Error:', error);
              }
              setDetailsRecovery(true);
              Alert.alert(
                'Address search failed',
                'Try entering the address manually.'
              );
            }}
            onNotFound={() => {
              if (__DEV__) {
                console.log('Google Places: No results');
              }
              setDetailsRecovery(true);
              Alert.alert(
                'Address not found',
                'Try refining the address or enter it manually.'
              );
            }}
            onPress={(data, details = null) => {
              selectedDescriptionRef.current = data.description;
              latestStreetRef.current = data.description;
              setManualLocality(false);
              if (!details) {
                latestLocalityRef.current = { city: '', state: '' };
                setDetailsRecovery(true);
                setDeliveryInfo((previous) => ({
                  ...clearGeocodedFields(previous),
                  address: data.description,
                }));
                return;
              }

              const parsed = parseGoogleAddressDetails(details);
              const missingLocality = !(
                parsed.city.trim() && parsed.state.trim()
              );
              latestLocalityRef.current = {
                city: parsed.city,
                state: parsed.state,
              };
              setDetailsRecovery(missingLocality);
              setDeliveryInfo((previous) => ({
                ...previous,
                address: data.description,
                city: parsed.city,
                state: parsed.state,
                country: parsed.country,
                countryCode: parsed.countryCode,
                postalCode: parsed.postalCode,
                latitude: parsed.latitude,
                longitude: parsed.longitude,
              }));
            }}
            placeholder="Enter delivery address"
            query={{
              key: googleMapsApiKey,
              language: 'en',
            }}
            styles={{
              container: { flex: 0 },
              description: { color: colors.text },
              listView: {
                backgroundColor: colors.textOnPrimary,
                borderColor: colors.border,
                borderRadius: 8,
                borderWidth: 1,
                elevation: 5,
                left: 0,
                marginTop: 4,
                position: 'absolute',
                right: 0,
                top: 50,
                zIndex: 1000,
              },
              row: { backgroundColor: 'transparent', padding: 12 },
              separator: { backgroundColor: colors.border },
            }}
            textInputProps={{
              onChangeText: (text) => {
                const selectedDescription = selectedDescriptionRef.current;
                const preserveSelection =
                  selectedDescription !== null && text === selectedDescription;
                const previousStreet =
                  selectedDescription ?? latestStreetRef.current;
                latestStreetRef.current = text;
                if (preserveSelection) {
                  setDeliveryInfo((previous) => ({
                    ...previous,
                    address: text,
                  }));
                  return;
                }
                selectedDescriptionRef.current = null;
                setDetailsRecovery(false);
                const keepsDestination = isFormattingOnlyStreetEdit(
                  previousStreet,
                  text
                );
                if (!keepsDestination) {
                  setManualLocality(Boolean(text.trim()));
                }
                if (!keepsDestination) {
                  latestLocalityRef.current = { city: '', state: '' };
                }
                setDeliveryInfo((previous) => ({
                  ...(keepsDestination
                    ? previous
                    : clearGeocodedFields(previous)),
                  address: text,
                }));
              },
              placeholderTextColor: colors.textMuted,
              style: {
                backgroundColor: colors.background,
                borderColor: colors.border,
                borderRadius: 8,
                borderWidth: 1,
                color: colors.text,
                fontSize: 16,
                paddingHorizontal: 12,
                paddingVertical: 12,
              },
              value: deliveryInfo.address,
            }}
          />
          {detailsRecovery ||
          manualLocality ||
          (deliveryInfo.address.trim() &&
            !(deliveryInfo.city.trim() && deliveryInfo.state.trim())) ? (
            <View style={{ marginTop: 8 }}>
              {manualLocality ? (
                <Text style={[styles.listSubValue, { color: colors.warning }]}>
                  Confirm the city and state match the delivery address before
                  saving.
                </Text>
              ) : null}
              {detailsRecovery ? (
                <Text
                  accessibilityRole="alert"
                  style={[styles.listSubValue, { color: colors.warning }]}
                >
                  {DETAILS_RECOVERY_ERROR}
                </Text>
              ) : null}
              <NewOrderManualLocalityFields
                city={deliveryInfo.city}
                colors={colors}
                onCityChange={(text) => setLocality('city', text)}
                onStateChange={(text) => setLocality('state', text)}
                state={deliveryInfo.state}
              />
            </View>
          ) : null}
        </>
      ) : (
        <>
          <TextInput
            onChangeText={(text) => {
              const previousStreet = latestStreetRef.current;
              latestStreetRef.current = text;
              const keepsDestination = isFormattingOnlyStreetEdit(
                previousStreet,
                text
              );
              if (!keepsDestination) {
                setManualLocality(Boolean(text.trim()));
              }
              if (!keepsDestination) {
                latestLocalityRef.current = { city: '', state: '' };
              }
              setDeliveryInfo((previous) => ({
                ...(keepsDestination
                  ? previous
                  : clearGeocodedFields(previous)),
                address: text,
              }));
            }}
            placeholder="Enter delivery address"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                borderWidth: 1,
                color: colors.text,
              },
            ]}
            value={deliveryInfo.address}
          />
          <NewOrderManualLocalityFields
            city={deliveryInfo.city}
            colors={colors}
            onCityChange={(text) => setLocality('city', text)}
            onStateChange={(text) => setLocality('state', text)}
            state={deliveryInfo.state}
          />
          <Text style={[styles.listSubValue, { color: colors.warning }]}>
            Address suggestions are unavailable because Google Maps is not
            configured.
          </Text>
        </>
      )}
    </View>
  );
}

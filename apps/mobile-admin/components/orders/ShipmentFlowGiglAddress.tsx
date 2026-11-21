import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import type {
  OrderGiglMissingField,
  OrderGiglReceiver,
  OrderGiglSelectedPlace,
} from '@/lib/order-gigl-shipping';
import { CheckoutRecoveryAddressInput } from './CheckoutRecoveryAddressInput';
import { ShipmentFlowActionButton } from './ShipmentFlowActionButton';

interface Props {
  addressDraft: Partial<OrderGiglReceiver>;
  loading: boolean;
  missingFields: OrderGiglMissingField[];
  onAddressFieldChange: (field: OrderGiglMissingField, value: string) => void;
  onEditAddress?: () => void;
  onPlaceSelect: (place: OrderGiglSelectedPlace) => void;
  onRetryQuote: () => void;
  selected: boolean;
}

const FIELD_LABELS: Record<OrderGiglMissingField, string> = {
  address: 'Shipping address',
  city: 'Shipping city',
  state: 'Shipping state',
  phone: 'Shipping phone',
};

export function ShipmentFlowGiglAddress({
  addressDraft,
  loading,
  missingFields,
  onAddressFieldChange,
  onEditAddress,
  onPlaceSelect,
  onRetryQuote,
  selected,
}: Props) {
  const { colors } = useTheme();
  const showPlacesSearch =
    missingFields.includes('address') &&
    Boolean(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY);
  const manualFields = missingFields.filter(
    (field) => field !== 'address' || !showPlacesSearch
  );
  const destination = [
    addressDraft.address,
    addressDraft.city,
    addressDraft.state,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <>
      {selected && missingFields.length === 0 && destination ? (
        <Text style={{ color: colors.textSecondary }}>
          Deliver to {destination}
        </Text>
      ) : null}
      {selected && missingFields.length === 0 && onEditAddress ? (
        <ShipmentFlowActionButton
          disabled={loading}
          label="Edit delivery address"
          onPress={onEditAddress}
        />
      ) : null}
      {showPlacesSearch ? (
        <>
          <CheckoutRecoveryAddressInput
            accessibilityLabel="Search or enter shipping address"
            address={addressDraft.address ?? ''}
            disabled={loading}
            onSearchChange={(text) => onAddressFieldChange('address', text)}
            onSelect={(place) => {
              const latitude = Number.parseFloat(place.latitude);
              const longitude = Number.parseFloat(place.longitude);
              const hasPin =
                Number.isFinite(latitude) && Number.isFinite(longitude);
              onPlaceSelect({
                address: place.address,
                city: place.city,
                state: place.state,
                latitude: hasPin ? latitude : undefined,
                longitude: hasPin ? longitude : undefined,
              });
            }}
            placeholder="Search or enter shipping address"
          />
          <Text style={{ color: colors.textSecondary, marginBottom: 10 }}>
            No suggestion? Type the full street address here, then enter the
            city and state below.
          </Text>
        </>
      ) : null}
      {manualFields.map((field) => (
        <View key={field} style={panelStyles.field}>
          <Text style={{ color: colors.text }}>{FIELD_LABELS[field]}</Text>
          <TextInput
            accessibilityLabel={FIELD_LABELS[field]}
            editable={!loading}
            onChangeText={(value) => onAddressFieldChange(field, value)}
            style={[
              panelStyles.input,
              { borderColor: colors.border, color: colors.text },
            ]}
            value={addressDraft[field] ?? ''}
          />
        </View>
      ))}
      {missingFields.length > 0 ? (
        <ShipmentFlowActionButton
          disabled={loading}
          label={onEditAddress ? 'Save address and get quote' : 'Retry quote'}
          onPress={onRetryQuote}
        />
      ) : null}
    </>
  );
}

const panelStyles = StyleSheet.create({
  field: { gap: 6, marginBottom: 10 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: 12,
  },
});

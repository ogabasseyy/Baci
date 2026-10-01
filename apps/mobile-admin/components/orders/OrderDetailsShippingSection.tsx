import { formatDeliveryMetadataLabel } from '@baci/shared';
import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';

interface OrderDetailsShippingSectionProps {
  address: string;
  airportType?: string | null;
  colors: ThemeColors;
  deliveryMethod?: string | null;
}

export function OrderDetailsShippingSection({
  address,
  airportType,
  colors,
  deliveryMethod,
}: OrderDetailsShippingSectionProps) {
  const deliveryMethodLabel =
    deliveryMethod === 'airport'
      ? airportType === 'pickup'
        ? 'Airport Pickup'
        : 'Airport Delivery'
      : formatDeliveryMetadataLabel(deliveryMethod);
  const airportTypeLabel =
    deliveryMethod === 'airport'
      ? formatDeliveryMetadataLabel(airportType)
      : null;

  return (
    <View
      accessibilityLabel="Shipping address"
      accessibilityRole="summary"
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.header}>
        <Ionicons
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          name="location-outline"
          size={18}
          color={colors.text}
        />
        <Text style={[styles.title, { color: colors.text }]}>
          Shipping Address
        </Text>
      </View>
      <Text style={[styles.addressText, { color: colors.textSecondary }]}>
        {address}
      </Text>
      {deliveryMethodLabel && (
        <View style={styles.metadataRow}>
          <Text style={[styles.metadataLabel, { color: colors.textSecondary }]}>
            Delivery Method
          </Text>
          <Text style={[styles.metadataValue, { color: colors.text }]}>
            {deliveryMethodLabel}
          </Text>
        </View>
      )}
      {airportTypeLabel && (
        <View style={styles.metadataRow}>
          <Text style={[styles.metadataLabel, { color: colors.textSecondary }]}>
            Airport Type
          </Text>
          <Text style={[styles.metadataValue, { color: colors.text }]}>
            {airportTypeLabel}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  addressText: {
    fontSize: 14,
    lineHeight: 22,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    padding: 16,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  metadataLabel: {
    fontSize: 12,
  },
  metadataRow: {
    gap: 4,
    marginTop: 12,
  },
  metadataValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
});

import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';

export function OxygenSelectedAddress({
  address,
  fromCheckout,
  disabled,
  onEdit,
}: {
  address: string;
  fromCheckout: boolean;
  disabled?: boolean;
  onEdit: () => void;
}) {
  const colors = useOxygenColors();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.heading}>
        <View style={styles.label}>
          <Ionicons name="location-outline" size={18} color={colors.primary} />
          <Text style={[styles.caption, { color: colors.textSecondary }]}>
            {fromCheckout ? 'From your checkout' : 'Your address'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change address"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onEdit}
          style={[
            styles.edit,
            {
              backgroundColor: colors.primaryLowOpacity,
              opacity: disabled ? 0.5 : 1,
            },
          ]}
        >
          <Ionicons name="create-outline" size={17} color={colors.primary} />
          <Text style={[styles.editText, { color: colors.primary }]}>Edit</Text>
        </Pressable>
      </View>
      <Text style={[styles.address, { color: colors.text }]}>{address}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 6,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  label: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  caption: { fontSize: 12, fontWeight: '500', flexShrink: 1 },
  edit: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  editText: { fontSize: 13, fontWeight: '600' },
  address: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
});

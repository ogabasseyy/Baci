import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';
export function OxygenEmploymentSummary({
  status,
  employer,
  income,
  payday,
  busy,
  onEdit,
}: {
  status: string;
  employer?: string;
  income: string;
  payday: string;
  busy?: boolean;
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
          <Ionicons name="briefcase-outline" size={19} color={colors.primary} />
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 13,
              fontWeight: '500',
            }}
          >
            Employment details
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit employment details"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onEdit}
          style={[styles.edit, { backgroundColor: colors.primaryLowOpacity }]}
        >
          <Ionicons name="create-outline" size={17} color={colors.primary} />
          <Text
            style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}
          >
            Edit
          </Text>
        </Pressable>
      </View>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>
        ₦{income}
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 13,
            fontWeight: '400',
          }}
        >
          {' '}
          / month
        </Text>
      </Text>
      <Text
        style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}
      >
        {[status, employer?.trim()].filter(Boolean).join(' · ')}
      </Text>
      <View style={[styles.payday, { borderTopColor: colors.border }]}>
        <Ionicons name="calendar-outline" size={17} color={colors.primary} />
        <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>
          Paid on the {payday}
        </Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    padding: 16,
    paddingTop: 8,
    borderWidth: 1,
    borderRadius: 16,
    gap: 8,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  label: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  edit: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  payday: {
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});

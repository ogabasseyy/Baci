import Ionicons from '@react-native-vector-icons/ionicons';
import { type ComponentRef, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';

export function OxygenPlanAmount({
  amount,
  percentage,
  disabled,
  onChange,
}: {
  amount: number;
  percentage: number;
  disabled: boolean;
  onChange: (amount: number) => void;
}) {
  const colors = useOxygenColors();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const formatted = Number.isFinite(amount)
    ? new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(
        amount
      )
    : '';
  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Text style={[styles.label, { color: colors.text }]}>
          Your down payment
        </Text>
        <View
          style={[styles.badge, { backgroundColor: colors.primaryLowOpacity }]}
        >
          <Text style={[styles.badgeText, { color: colors.primary }]}>
            {Number.isFinite(percentage) ? `${percentage}%` : '—'}
          </Text>
        </View>
      </View>
      <View
        style={[
          styles.amount,
          {
            backgroundColor: colors.background,
            borderColor: focused ? colors.primary : colors.border,
          },
        ]}
      >
        <Text style={[styles.symbol, { color: colors.textSecondary }]}>₦</Text>
        <TextInput
          ref={input}
          accessibilityLabel="Down payment amount"
          keyboardType="decimal-pad"
          editable={!disabled}
          selectTextOnFocus
          value={focused ? draft : formatted}
          onFocus={() => {
            setDraft(Number.isFinite(amount) ? String(amount) : '');
            setFocused(true);
          }}
          onBlur={() => setFocused(false)}
          onChangeText={(text) => {
            const clean = text.replace(/,/g, '');
            if (!/^\d*(?:\.\d{0,2})?$/.test(clean)) return;
            setDraft(clean);
            onChange(clean.trim() ? Number(clean) : Number.NaN);
          }}
          placeholder="0.00"
          placeholderTextColor={colors.placeholder}
          style={[styles.input, { color: colors.text }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit down payment"
          disabled={disabled}
          onPress={() => input.current?.focus()}
          style={styles.edit}
        >
          <Ionicons name="pencil-outline" size={18} color={colors.primary} />
        </Pressable>
      </View>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        Excludes upfront charges
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  label: { fontSize: 16, fontWeight: '600' },
  badge: { borderRadius: 30, paddingVertical: 5, paddingHorizontal: 11 },
  badgeText: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  amount: {
    borderWidth: 1,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    minHeight: 78,
    gap: 7,
  },
  symbol: { fontSize: 25, fontWeight: '500' },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 32,
    fontWeight: '700',
    paddingVertical: 14,
    fontVariant: ['tabular-nums'],
  },
  edit: {
    width: 44,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { fontSize: 12, lineHeight: 17 },
});

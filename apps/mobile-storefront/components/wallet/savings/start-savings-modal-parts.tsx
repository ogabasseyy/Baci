import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { BRAND, withAlpha } from '@/constants/Colors';
import type { CustomerPaymentMethod } from '@/lib/customer-savings';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';

export function FundingOptionCard({
  active,
  colors,
  description,
  label,
  onPress,
}: {
  active: boolean;
  colors: StartSavingsColors;
  description: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.fundingOptionCard,
        {
          borderColor: active ? BRAND.primary : colors.border,
          backgroundColor: active
            ? withAlpha(BRAND.primary, 0.07)
            : colors.card,
        },
      ]}
    >
      <Text style={[styles.fundingOptionTitle, { color: colors.text }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.fundingOptionDescription,
          { color: colors.textSecondary },
        ]}
      >
        {description}
      </Text>
    </Pressable>
  );
}

export function SavedPaymentMethodCard({
  active,
  colors,
  disabled = false,
  method,
  onPress,
}: {
  active: boolean;
  colors: StartSavingsColors;
  /** No change of card while the plan is being created or a card added. */
  disabled?: boolean;
  method: CustomerPaymentMethod;
  onPress: () => void;
}) {
  const metadata = [
    method.bank,
    method.brand,
    method.last4 ? `•••• ${method.last4}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Select ${method.label}`}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.savedPaymentMethodCard,
        {
          borderColor: active ? BRAND.primary : colors.border,
          backgroundColor: active
            ? withAlpha(BRAND.primary, 0.07)
            : colors.card,
        },
      ]}
    >
      <View style={styles.savedPaymentMethodHeader}>
        <Text style={[styles.savedPaymentMethodTitle, { color: colors.text }]}>
          {method.label}
        </Text>
        {active ? (
          <Ionicons
            name="checkmark-circle"
            size={18}
            color={BRAND.primary}
            accessibilityLabel="Saved payment method selected"
            accessibilityRole="image"
          />
        ) : null}
      </View>
      {metadata ? (
        <Text
          style={[
            styles.savedPaymentMethodMeta,
            { color: colors.textSecondary },
          ]}
        >
          {metadata}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function SummaryRow({
  colors,
  label,
  value,
}: {
  colors: StartSavingsColors;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text style={[styles.summaryValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

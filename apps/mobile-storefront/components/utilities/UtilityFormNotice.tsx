import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, SPACING } from '@/constants/Colors';

interface UtilityFormNoticeProps {
  /** Optional link under the message, such as "Add store credit". */
  action?: { label: string; onPress: () => void } | null;
  message: string;
  /** Tighter spacing for a notice sitting directly under a field. */
  compact?: boolean;
}

/**
 * Calm in-page notice for the utility forms: why Pay is not available yet or
 * what a field still needs. Same look as the "Not enough store credit" nudge
 * in the payment section, so validation never needs a system alert.
 */
export function UtilityFormNotice({
  action,
  compact = false,
  message,
}: UtilityFormNoticeProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.notice,
        compact ? styles.compact : null,
        {
          backgroundColor: `${BRAND.primary}10`,
          borderColor: `${BRAND.primary}30`,
        },
      ]}
    >
      <Text style={[styles.text, { color: colors.text }]}>{message}</Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          hitSlop={8}
          onPress={action.onPress}
        >
          <Text style={styles.cta}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  compact: {
    marginBottom: 0,
    marginTop: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  cta: {
    color: BRAND.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  notice: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
  },
  text: {
    fontSize: 13,
    lineHeight: 18,
  },
});

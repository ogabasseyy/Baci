import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  RADIUS,
  SPACING,
  type ThemeColors,
  TYPOGRAPHY,
} from '@/constants/theme';

/**
 * Shown above a chat when the customer lookup failed, so a store outage is not
 * mistaken for a guest chat. Retrying asks for the customer again.
 */
export function CustomerUnavailable({
  colors,
  onRetry,
}: {
  colors: ThemeColors;
  onRetry: () => void;
}) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.text, { color: colors.textSecondary }]}>
        Customer details could not be loaded.
      </Text>
      <Pressable
        accessibilityLabel="Retry loading customer details"
        accessibilityRole="button"
        onPress={onRetry}
        style={styles.retry}
      >
        <Text style={{ color: colors.primary }}>Tap to retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    justifyContent: 'space-between',
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  retry: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: SPACING.touchTarget,
  },
  text: { flex: 1, fontFamily: TYPOGRAPHY.fontFamily.medium },
});

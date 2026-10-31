import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { RADIUS, SPACING, withAlpha } from '@/constants/Colors';
import type { ImeiCheckerColors } from './imei-check.types';

export function ImeiCheckPending({
  colors,
  paused,
  canResume = true,
}: {
  colors: ImeiCheckerColors;
  paused: boolean;
  canResume?: boolean;
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.container,
        {
          backgroundColor: withAlpha(colors.tint, 0.08),
          borderColor: withAlpha(colors.tint, 0.22),
        },
      ]}
    >
      <ActivityIndicator animating={!paused} color={colors.tint} />
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>
          {paused ? 'Your check is still processing' : "We're checking"}
        </Text>
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          {!canResume
            ? 'Keep this screen open while we check. Progress could not be saved on this device.'
            : paused
              ? "You can leave this screen and check back later. We'll keep processing it safely."
              : 'This is usually under a minute. You can leave and return without paying again.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: RADIUS['2xl'],
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    padding: SPACING.md,
  },
  content: { flex: 1 },
  message: { fontSize: 13, marginTop: 4 },
  title: { fontSize: 15, fontWeight: '700' },
});

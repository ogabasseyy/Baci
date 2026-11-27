import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SPACING, type ThemeColors, TYPOGRAPHY } from '@/constants/theme';
import { NetworkError } from '@/lib/api-client';

interface InboxLoadErrorProps {
  colors: ThemeColors;
  error: unknown;
  onRetry: () => void;
}

function errorText(error: unknown): string {
  if (error instanceof NetworkError && error.statusCode === 403) {
    return 'You do not have permission to read customer messages.';
  }
  if (error instanceof NetworkError && error.statusCode === 404) {
    return 'Messages are not set up for this store yet.';
  }
  return 'Could not load messages. Please try again.';
}

/** The whole screen when there are no chats to show because a request failed. */
export function InboxLoadError({
  colors,
  error,
  onRetry,
}: InboxLoadErrorProps) {
  return (
    <View style={styles.centered}>
      <Text style={[styles.title, { color: colors.text }]}>
        {errorText(error)}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => onRetry()}
        style={styles.retry}
      >
        <Text style={{ color: colors.primary }}>Tap to retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: SPACING.sm,
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  retry: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: SPACING.touchTarget,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.lg,
    textAlign: 'center',
  },
});

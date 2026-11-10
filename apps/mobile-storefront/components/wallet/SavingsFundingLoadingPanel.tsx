import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type Colors from '@/constants/Colors';
import { RADIUS, SPACING } from '@/constants/Colors';

export function SavingsFundingLoadingPanel({
  colors,
  onRetry,
  state = 'checking',
}: {
  colors: (typeof Colors)['light'];
  onRetry?: () => void;
  state?: 'checking' | 'error' | 'identity';
}) {
  const copy = {
    checking: {
      title: 'Almost ready',
      body: 'We’re checking that your savings wallet is ready. You can add money as soon as it’s confirmed.',
    },
    error: {
      title: 'We couldn’t confirm your wallet is ready.',
      body: 'For your security, savings actions are paused until we can verify your wallet.',
    },
    identity: {
      title: 'Sign in to add to savings',
      body: 'Your wallet must be linked to your account before you can add money.',
    },
  }[state];
  return (
    <View
      accessible={state === 'checking'}
      accessibilityRole={state === 'checking' ? 'progressbar' : undefined}
      accessibilityLabel={
        state === 'checking' ? 'Checking savings availability' : undefined
      }
      style={[styles.panel, { backgroundColor: colors.primaryLowOpacity }]}
    >
      {state === 'checking' ? (
        <ActivityIndicator color={colors.primary} size="small" />
      ) : null}
      <View style={styles.copy}>
        <Text
          accessibilityRole={state === 'checking' ? undefined : 'alert'}
          accessibilityLiveRegion="polite"
          style={[styles.title, { color: colors.primary }]}
        >
          {copy.title}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {copy.body}
        </Text>
        {state === 'error' && onRetry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={onRetry}
            style={styles.retry}
          >
            <Text style={[styles.retryText, { color: colors.primary }]}>
              Try again
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    flexDirection: 'row',
    gap: SPACING.md,
    minHeight: 72,
    padding: SPACING.md,
  },
  copy: { flex: 1, gap: SPACING.xs },
  title: { fontSize: 14, fontWeight: '700' },
  body: { fontSize: 12, lineHeight: 19 },
  retry: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44 },
  retryText: { fontSize: 13, fontWeight: '700' },
});

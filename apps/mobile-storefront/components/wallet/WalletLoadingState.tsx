import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import { styles } from './wallet.styles';

/** Long enough for a slow network, short enough not to strand anyone. */
export const WALLET_LOAD_TIMEOUT_MS = 20_000;
export const WALLET_LOAD_FAILED_COPY = "We couldn't load your wallet";
const LOAD_ERROR_MESSAGE = 'Unable to load wallet.';

type WalletLoadingStateProps = {
  colors: (typeof Colors)['light'];
  message?: string;
  onRetry?: () => unknown;
};

/**
 * The wallet's loading state, bounded (walk-through): a hung or failed load
 * turns into "We couldn't load your wallet" with Try again instead of an
 * endless spinner. A cached wallet never reaches this view.
 */
export function WalletLoadingState({
  colors,
  message,
  onRetry,
}: WalletLoadingStateProps) {
  const [attempt, setAttempt] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  // The deadline covers the wallet load itself (Codex): it restarts when
  // the screen moves from auth hydration (no retry) to the wallet query.
  const retryable = Boolean(onRetry);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt (a retry) and retryable (the wallet load starting) are intentional retriggers.
  useEffect(() => {
    setTimedOut(false);
    const timer = setTimeout(() => setTimedOut(true), WALLET_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [attempt, retryable]);
  const failed = onRetry && (timedOut || message === LOAD_ERROR_MESSAGE);
  if (failed) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          {WALLET_LOAD_FAILED_COPY}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={() => {
            setAttempt((value) => value + 1);
            void onRetry();
          }}
          style={{ marginTop: 16, minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ color: BRAND.primary, fontWeight: '700' }}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={[styles.container, styles.centered]}>
      <ActivityIndicator
        testID="wallet-activity-indicator"
        accessibilityLabel="Preparing wallet"
        size="large"
        color={BRAND.primary}
      />
      {message ? (
        <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

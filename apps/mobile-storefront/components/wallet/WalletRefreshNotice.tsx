import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WALLET_COLORS } from './wallet.colors';

export type WalletRefreshState = 'updating' | 'offline' | 'error';

export function WalletRefreshNotice({
  state,
  onRetry,
}: {
  state?: WalletRefreshState;
  onRetry?: () => void;
}) {
  if (!state) return null;
  const message =
    state === 'updating'
      ? 'Updating balance…'
      : state === 'offline'
        ? 'Offline · Last saved balance'
        : 'Couldn’t refresh · Last saved balance';

  return (
    <View style={styles.notice}>
      <Text accessibilityLiveRegion="polite" style={styles.message}>
        {message}
      </Text>
      {state === 'error' && onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry wallet refresh"
          onPress={onRetry}
          style={styles.retry}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  message: { color: WALLET_COLORS.mutedText, fontSize: 11, flex: 1 },
  retry: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  retryText: { color: WALLET_COLORS.white, fontSize: 12, fontWeight: '600' },
});

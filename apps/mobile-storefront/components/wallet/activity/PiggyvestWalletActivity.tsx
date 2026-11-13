import Ionicons from '@react-native-vector-icons/ionicons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type Colors from '@/constants/Colors';
import { usePiggyvestWalletActivity } from '@/hooks/use-piggyvest-wallet-activity';
import { styles } from '../wallet.styles';
import { PiggyvestActivityRow } from './PiggyvestActivityRow';

type Props = {
  colors: (typeof Colors)['light'];
  merchantId?: string;
  /** The wallet's last refresh: re-reads the first page with it. */
  refreshKey?: number;
};

/**
 * PiggyVest wallet activity under the wallet card: money added, savings
 * contributions, goal refunds and completions, newest first. Loading, a
 * calm "couldn't load" with Try again, and an empty state.
 */
export function PiggyvestWalletActivity({
  colors,
  merchantId,
  refreshKey,
}: Props) {
  const activity = usePiggyvestWalletActivity({
    merchantId,
    enabled: true,
    refreshKey,
  });
  const button = (label: string, onPress: () => void, busy = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={[local.button, { backgroundColor: colors.muted }]}
    >
      {busy ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Text style={[local.buttonText, { color: colors.text }]}>{label}</Text>
      )}
    </Pressable>
  );
  return (
    <View
      testID="piggyvest-wallet-activity"
      style={[
        styles.historySection,
        local.aligned,
        { backgroundColor: colors.card },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Wallet activity
      </Text>
      {activity.isLoading ? (
        <View style={local.state} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.primary} />
          <Text style={[local.stateText, { color: colors.textSecondary }]}>
            Loading your activity…
          </Text>
        </View>
      ) : activity.isError ? (
        <View style={local.state} accessibilityLiveRegion="polite">
          <Text style={[local.stateText, { color: colors.textSecondary }]}>
            We couldn’t load your wallet activity.
          </Text>
          {button('Try again', activity.retry)}
        </View>
      ) : activity.items.length === 0 ? (
        <View style={styles.emptyTransactions}>
          <Ionicons
            accessible={false}
            importantForAccessibility="no"
            name="receipt-outline"
            size={40}
            color={colors.textSecondary}
          />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No wallet activity yet
          </Text>
        </View>
      ) : (
        <>
          {activity.items.map((item) => (
            <PiggyvestActivityRow colors={colors} item={item} key={item.id} />
          ))}
          {activity.hasMore
            ? button('Show more', activity.loadMore, activity.isLoadingMore)
            : null}
        </>
      )}
    </View>
  );
}

const local = StyleSheet.create({
  // Same 16pt edge as the wallet cards (walk-through alignment).
  aligned: { paddingHorizontal: 0 },
  state: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  stateText: { fontSize: 13, textAlign: 'center' },
  button: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: 999,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 44,
  },
  buttonText: { fontSize: 14, fontWeight: '700' },
});

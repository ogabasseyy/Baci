import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type Colors from '@/constants/Colors';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import type { SavingsPlanFundingAccount } from '@/schemas/customer-savings';
import { getErrorMessage } from './start-savings-controller.utils';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';

type Props = {
  account?: SavingsPlanFundingAccount;
  colors: (typeof Colors)['light'];
  error: string | null;
  onRefresh: () => void;
  phase: SavingsPlanFundingPhase;
};

export function SavingsPlanTransferPanel({
  account,
  colors,
  error,
  onRefresh,
  phase,
}: Props) {
  const { copyToClipboard, feedback } = useCopyToClipboard();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const isMountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);
  const loading = phase === 'idle' || phase === 'loading';
  const ready = phase === 'ready' && account;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleRefresh = async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await onRefresh();
    } catch (error) {
      if (isMountedRef.current) {
        setRefreshError(
          getErrorMessage(error, 'Unable to refresh savings progress.')
        );
      }
    } finally {
      refreshInFlightRef.current = false;
      if (isMountedRef.current) setRefreshing(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.heading, { color: colors.text }]}>
        Bank transfer
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        This account belongs to your savings plan, not your spending wallet.
      </Text>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        {ready ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy savings account number"
              onPress={() => void copyToClipboard(account.accountNumber)}
              style={styles.copy}
            >
              <Text selectable style={[styles.number, { color: colors.text }]}>
                {account.accountNumber}
              </Text>
              <Ionicons name="copy-outline" size={20} color={colors.primary} />
            </Pressable>
            <Text style={[styles.bank, { color: colors.textSecondary }]}>
              {account.bankName}
            </Text>
            {feedback ? (
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: colors.textSecondary }}
              >
                {feedback}
              </Text>
            ) : null}
          </>
        ) : loading ? (
          <View style={styles.loading}>
            <ActivityIndicator
              color={colors.primary}
              accessibilityLabel="Loading savings account"
            />
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              Loading your plan account…
            </Text>
          </View>
        ) : (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.body, { color: colors.textSecondary }]}
          >
            {phase === 'error'
              ? error || 'Unable to load your plan account. Try again.'
              : phase === 'pending'
                ? 'Your plan account is being prepared. Refresh to check again.'
                : 'No account is available for this plan yet. Refresh to check its status.'}
          </Text>
        )}
      </View>
      <Text style={[styles.notice, { color: colors.textSecondary }]}>
        Sandbox account · Do not send real money. Test funding is confirmed only
        after PiggyVest reports receipt.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh savings account"
        accessibilityState={{
          disabled: loading || refreshing,
          busy: loading || refreshing,
        }}
        disabled={loading || refreshing}
        onPress={() => void handleRefresh()}
        style={styles.refresh}
      >
        <Ionicons name="refresh-outline" size={16} color={colors.primary} />
        <Text style={[styles.bank, { color: colors.primary }]}>
          {refreshing ? 'Refreshing…' : 'Refresh account'}
        </Text>
      </Pressable>
      {refreshError ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.body, { color: colors.error }]}
        >
          {refreshError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  heading: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 21 },
  card: { borderRadius: 20, borderWidth: 1, padding: 20, gap: 6 },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    flexWrap: 'wrap',
  },
  number: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  bank: { fontSize: 14, fontWeight: '500' },
  notice: { fontSize: 12, lineHeight: 18 },
  refresh: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
  loading: { flexDirection: 'row', gap: 10, alignItems: 'center' },
});

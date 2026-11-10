import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { getErrorMessage } from './start-savings-controller.utils';

type Props = {
  colors: (typeof Colors)['light'];
  onRefresh: () => Promise<unknown>;
  /** True only when the merchant has an explicit primary (PiggyVest) verdict. */
  primary?: boolean;
};

/**
 * Savings goals are funded from the customer's PiggyVest wallet only. The
 * goal's own bank account is hidden (not absent), so nobody can send a bank
 * transfer to it and strand the money. This note replaces that account.
 */
export function SavingsPlanWalletNote({
  colors,
  onRefresh,
  primary = false,
}: Props) {
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const isMountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);

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
    let failure: { error: unknown } | null = null;
    try {
      await onRefresh();
    } catch (error) {
      failure = { error };
    }
    refreshInFlightRef.current = false;
    if (!isMountedRef.current) return;
    setRefreshing(false);
    if (failure) {
      setRefreshError(
        getErrorMessage(failure.error, 'Unable to refresh savings progress.')
      );
    }
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.heading, { color: colors.text }]}>
        Add from your wallet
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        {primary
          ? "Savings plans are funded by moving money from your PiggyVest wallet. The plan's own account is kept hidden, so do not send a bank transfer to a plan."
          : "Savings plans are funded by moving money from your wallet. The plan's own account is kept hidden, so do not send a bank transfer to a plan."}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh savings progress"
        accessibilityState={{ disabled: refreshing, busy: refreshing }}
        disabled={refreshing}
        onPress={() => void handleRefresh()}
        style={styles.refresh}
      >
        <Ionicons name="refresh-outline" size={16} color={colors.primary} />
        <Text style={[styles.action, { color: colors.primary }]}>
          {refreshing ? 'Refreshing…' : 'Refresh progress'}
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
  heading: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 21 },
  action: { fontSize: 13, fontWeight: '500' },
  refresh: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
});

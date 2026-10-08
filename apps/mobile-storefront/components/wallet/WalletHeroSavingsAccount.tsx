import { useNavigation } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';
import { useSavingsPlanFunding } from './savings/use-savings-plan-funding';
import { WalletHeroFundingAccount } from './WalletHeroFundingAccount';

type Props = { goalId: string; isRefetching: boolean };

export function WalletHeroSavingsAccount({ goalId, isRefetching }: Props) {
  const navigation = useNavigation();
  const userId = useAuthStore((state) => state.user?.id);
  const merchantId = useAuthStore((state) => state.merchantId);
  const activeMerchantId =
    pickMerchantId(merchantId, CONFIG.MERCHANT_ID) ?? undefined;
  const enabled = Boolean(userId && activeMerchantId);
  const funding = useSavingsPlanFunding({
    activeMerchantId,
    activeMerchantSlug: CONFIG.MERCHANT_SLUG?.trim() || undefined,
    goalId: enabled ? goalId : null,
    identityKey: userId,
    loadExisting: enabled,
  });
  const lookupRef = useRef(funding.fetchExistingPlanFunding);
  lookupRef.current = funding.fetchExistingPlanFunding;
  const wasRefetching = useRef(isRefetching);

  useEffect(() => {
    if (wasRefetching.current && !isRefetching && enabled) {
      void lookupRef.current();
    }
    wasRefetching.current = isRefetching;
  }, [enabled, isRefetching]);

  useEffect(
    () =>
      navigation.addListener('focus', () => {
        if (enabled) void lookupRef.current();
      }),
    [navigation, enabled]
  );

  const account =
    funding.planFundingPhase === 'ready'
      ? funding.planFundingAccounts[0]
      : undefined;
  if (enabled && account) {
    return (
      <WalletHeroFundingAccount
        account={{ ...account, provider: 'piggyvest' }}
        purpose="savings"
        sandbox
      />
    );
  }

  const loading =
    enabled && ['idle', 'loading'].includes(funding.planFundingPhase);
  const label = !enabled
    ? 'Sign in to view savings account'
    : loading
      ? 'Loading savings account'
      : funding.planFundingPhase === 'error' ||
          funding.planFundingPhase === 'unavailable'
        ? 'Unable to load savings account'
        : 'Savings account not ready';

  return (
    <View style={styles.container}>
      <Text style={styles.label}>SAVINGS · TEST</Text>
      {loading ? (
        <ActivityIndicator
          accessibilityLabel="Loading savings account"
          size="small"
          color="#F8B84C"
        />
      ) : null}
      <Text style={styles.message}>{label}</Text>
      {enabled && !loading ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry savings account lookup"
          onPress={() => void lookupRef.current()}
          style={styles.retry}
        >
          <Text style={styles.label}>Refresh account</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 0,
    borderLeftWidth: 1,
    borderLeftColor: '#393D43',
    paddingLeft: 12,
    alignItems: 'flex-end',
    gap: 4,
  },
  label: { color: '#F8B84C', fontSize: 10, fontWeight: '700' },
  message: { color: '#AEB4BE', fontSize: 11, textAlign: 'right' },
  retry: { minHeight: 44, justifyContent: 'center' },
});

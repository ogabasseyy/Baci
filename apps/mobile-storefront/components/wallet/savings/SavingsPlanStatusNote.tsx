import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { useSavingsPlanFunding } from './use-savings-plan-funding';

type Props = {
  colors: (typeof Colors)['light'];
  goalId: string;
  identityKey: string;
  merchantId: string;
};

/**
 * Tells a customer whose plan wallet is not ready yet to check back. It only
 * reads status (never provisions) and never shows the goal's account number.
 * Setting up an existing goal is a separate, status-gated change.
 */
export function SavingsPlanStatusNote({
  colors,
  goalId,
  identityKey,
  merchantId,
}: Props) {
  const primary = isPiggyvestPrimaryMerchant(merchantId);
  const funding = useSavingsPlanFunding({
    activeMerchantId: merchantId,
    goalId,
    identityKey,
    loadExisting: primary,
    notFoundMeansPending: true,
  });
  if (!primary || funding.planFundingRequiresBvn) return null;
  const phase = funding.planFundingPhase;
  if (phase === 'idle' || phase === 'loading' || phase === 'ready') return null;
  if (phase === 'error') {
    return (
      <View style={styles.section}>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          We couldn't check this goal's status.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={() => void funding.fetchExistingPlanFunding()}
          style={styles.retry}
        >
          <Text style={[styles.action, { color: colors.primary }]}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }
  return (
    <Text style={[styles.body, { color: colors.textSecondary }]}>
      {phase === 'unavailable'
        ? 'Setup is not available for this goal right now.'
        : 'This goal is still being set up. Please check back shortly.'}
    </Text>
  );
}

const styles = StyleSheet.create({
  section: { gap: 6 },
  body: { fontSize: 14, lineHeight: 21 },
  action: { fontSize: 14, fontWeight: '500' },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});

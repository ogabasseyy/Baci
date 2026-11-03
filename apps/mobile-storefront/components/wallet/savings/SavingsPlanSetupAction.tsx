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
 * Lets a customer finish setting up an existing plan's provider wallet after
 * the creation screen is gone. Only readiness is shown; the goal's account
 * number is never retained or displayed. Legacy plans that need a BVN are set
 * up in the creation flow, so nothing renders for them.
 */
export function SavingsPlanSetupAction({
  colors,
  goalId,
  identityKey,
  merchantId,
}: Props) {
  const funding = useSavingsPlanFunding({
    activeMerchantId: merchantId,
    goalId,
    identityKey,
    // Legacy merchants never read plan funding here: setup there needs a BVN
    // and happens in the creation flow.
    loadExisting: isPiggyvestPrimaryMerchant(merchantId),
  });
  if (funding.planFundingRequiresBvn) return null;
  const phase = funding.planFundingPhase;
  if (phase === 'ready') {
    return (
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        This goal is set up and ready to fund from your wallet.
      </Text>
    );
  }
  const busy = phase === 'loading';
  const label = busy
    ? 'Setting up…'
    : phase === 'pending'
      ? 'Check again'
      : 'Set up this goal';
  return (
    <View style={styles.section}>
      {phase === 'pending' ? (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          This goal is still being set up. Check again in a moment.
        </Text>
      ) : null}
      {phase === 'unavailable' ? (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Setup is not available for this goal right now.
        </Text>
      ) : null}
      {funding.fundingError ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.body, { color: colors.error }]}
        >
          {funding.fundingError}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={() => void funding.fetchPlanFunding('')}
        style={styles.action}
      >
        <Text style={[styles.actionText, { color: colors.primary }]}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  body: { fontSize: 14, lineHeight: 21 },
  action: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  actionText: { fontSize: 14, fontWeight: '500' },
});

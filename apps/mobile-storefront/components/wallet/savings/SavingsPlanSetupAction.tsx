import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { PLAN_NOT_SET_UP_MESSAGE } from '@/lib/customer-savings-plan-funding';
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
  // Provisioning only runs when the status read says nothing was ever set up.
  // Every other state re-reads status: provisioning again could send a
  // different interest choice than the one already stored for the goal.
  const needsSetup =
    phase === 'idle' || funding.fundingError === PLAN_NOT_SET_UP_MESSAGE;
  const label = busy
    ? 'Setting up…'
    : needsSetup
      ? 'Set up this goal'
      : 'Check again';
  const onPress = () =>
    needsSetup
      ? funding.fetchPlanFunding('', { enableInterestAccrual: false })
      : funding.fetchExistingPlanFunding();
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
      {funding.fundingError && !needsSetup ? (
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
        onPress={() => void onPress()}
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

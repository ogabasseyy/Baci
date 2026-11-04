import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { SavingsGoalSetupPrompt } from './SavingsGoalSetupPrompt';
import { useSavingsGoalSetup } from './use-savings-goal-setup';
import { useSavingsPlanFunding } from './use-savings-plan-funding';

type Props = {
  colors: (typeof Colors)['light'];
  goalId: string;
  identityKey: string;
  merchantId: string;
};

/**
 * Tells a customer whose plan wallet is not ready yet to check back, and
 * never shows the goal's account number. A goal whose setup never started
 * (confirmed by a finished status read, on a primary merchant with an
 * available verdict) also gets the explicit interest question and a setup
 * action; setup is never offered while status is unknown or pending.
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
    notFoundMeansNotStarted: true,
  });
  const setup = useSavingsGoalSetup({
    goalId,
    merchantId,
    onSettled: () => void funding.fetchExistingPlanFunding(),
  });
  if (!primary || funding.planFundingRequiresBvn) return null;
  const phase = funding.planFundingPhase;
  const rereadingAfterSetup = phase === 'loading' && setup.attempted;
  if (phase === 'not_started' || rereadingAfterSetup)
    return (
      <SavingsGoalSetupPrompt
        colors={colors}
        choice={setup.choice}
        statusReady={phase === 'not_started'}
        submitting={setup.submitting}
        error={setup.error}
        onChoose={setup.setChoice}
        onSubmit={() => void setup.submit()}
      />
    );
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

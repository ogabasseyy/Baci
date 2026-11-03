import { StyleSheet, Text } from 'react-native';
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
  });
  if (!primary || funding.planFundingRequiresBvn) return null;
  if (funding.planFundingPhase === 'ready') return null;
  return (
    <Text style={[styles.body, { color: colors.textSecondary }]}>
      This goal is still being set up. Please check back shortly.
    </Text>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 21 },
});

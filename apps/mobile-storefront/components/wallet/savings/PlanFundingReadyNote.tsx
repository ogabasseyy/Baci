import { Text } from 'react-native';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';

/**
 * The plan's own bank account is prepared at PiggyVest but never shown: money
 * sent straight to it would not reach the goal. The customer funds the plan
 * from their wallet instead.
 */
export function PlanFundingReadyNote({
  colors,
}: {
  colors: StartSavingsColors;
}) {
  return (
    <Text
      style={[styles.emptyFundingAccountText, { color: colors.textSecondary }]}
    >
      Your plan is ready. Fund it by moving money from your wallet. Plans do not
      take bank transfers.
    </Text>
  );
}

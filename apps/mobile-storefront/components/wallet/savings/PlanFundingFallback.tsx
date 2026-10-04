import { Text, View } from 'react-native';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { TransferModalProps } from './start-savings-transfer-modal-props';
import { FundingAccountDetails } from './FundingAccountDetails';

export function PlanFundingFallback({
  colors,
  controller,
}: TransferModalProps) {
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={[
          styles.emptyFundingAccountText,
          { color: colors.textSecondary },
        ]}
      >
        {controller.planFundingPhase === 'error'
          ? (controller.planFundingError ??
            'The plan account is unavailable right now.')
          : 'The plan account is not ready yet.'}{' '}
        Fund your wallet instead and record the contribution below.
      </Text>
      {controller.fundingAccount ? (
        <FundingAccountDetails colors={colors} controller={controller} />
      ) : null}
    </View>
  );
}

import { View } from 'react-native';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';
import { FundingOptionCard } from './start-savings-modal-parts';

type Props = {
  colors: StartSavingsColors;
  controller: StartSavingsController;
};

export function StartSavingsManualFundingContent({
  colors,
  controller,
}: Props) {
  // Locked while the plan is being created: the request already in flight
  // uses the choice made when Create was tapped.
  const busy = controller.isSubmitting || controller.isAuthorizingCard;
  return (
    <View style={styles.fundingOptionRow}>
      <FundingOptionCard
        active={controller.selectedFundingOption === 'wallet'}
        description={`Use available wallet balance (${formatNgnCurrency(controller.safeWalletBalance)}) for your initial contribution.`}
        label="Pay with wallet balance"
        disabled={busy}
        onPress={() => controller.setSelectedFundingOption('wallet')}
        colors={colors}
      />
      <FundingOptionCard
        active={controller.selectedFundingOption === 'bank_transfer'}
        description="Show your dedicated account number and create the plan after wallet funding lands."
        label="Pay with bank transfer"
        disabled={busy}
        onPress={() => controller.setSelectedFundingOption('bank_transfer')}
        colors={colors}
      />
    </View>
  );
}

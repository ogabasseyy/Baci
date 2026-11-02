import type { ComponentProps } from 'react';
import { Text } from 'react-native';
import { WalletPendingSavingsContribution } from './WalletPendingSavingsContribution';
import { WalletSavingsContributionFlow } from './WalletSavingsContributionFlow';
import { WalletSavingsContributionPreparation } from './WalletSavingsContributionPreparation';
import { WalletSavingsPlanFunding } from './WalletSavingsPlanFunding';
import { walletSavingsProgressModalStyles as styles } from './wallet-savings-progress-modal.styles';

type Props = ComponentProps<typeof WalletSavingsContributionFlow> & {
  goal: ComponentProps<typeof WalletSavingsPlanFunding>['goal'];
  hasPendingContribution: boolean;
  canAdd: boolean;
  usesPlanFunding: boolean;
  visible: boolean;
  onRefreshWallet?: () => Promise<unknown>;
};

export function WalletSavingsContributionSection({
  goal,
  hasPendingContribution,
  canAdd,
  usesPlanFunding,
  visible,
  onRefreshWallet,
  ...flow
}: Props) {
  if (hasPendingContribution)
    return (
      <WalletPendingSavingsContribution
        colors={flow.colors}
        isChecking={flow.isAdding}
        onCheck={flow.onAddSavings}
      />
    );
  if (canAdd && usesPlanFunding)
    return visible ? (
      <WalletSavingsPlanFunding
        key={goal.id}
        addAmount={flow.addAmount}
        colors={flow.colors}
        goal={goal}
        onAddAmountChange={flow.onAddAmountChange}
        onRefreshWallet={onRefreshWallet}
      />
    ) : null;
  if (canAdd) {
    if (
      flow.usesWalletBankTransfer &&
      goal.source_mode === 'manual' &&
      flow.walletBalance > 0 &&
      !(Number(flow.addAmount) > flow.walletBalance)
    )
      return visible ? (
        <WalletSavingsContributionPreparation goalId={goal.id} {...flow} />
      ) : null;
    return <WalletSavingsContributionFlow {...flow} />;
  }
  return (
    <Text style={[styles.autoDebitHint, { color: flow.colors.textSecondary }]}>
      {goal.status === 'completed'
        ? 'This savings goal is complete.'
        : 'This goal is funded by scheduled auto-debit.'}
    </Text>
  );
}

import { useState } from 'react';
import type Colors from '@/constants/Colors';
import { SavingsFirstCardCheckout } from './SavingsFirstCardCheckout';
import { SavingsPlanCardContributionView } from './SavingsPlanCardContributionView';
import { savingsCardContributionUtils } from './savings-card-contribution-utils';
import { useSavingsCardContribution } from './use-savings-card-contribution';

type Props = {
  amount: string;
  colors: (typeof Colors)['light'];
  goalId: string;
  merchantId: string;
  onAmountChange: (amount: string) => void;
  onRefreshWallet?: () => Promise<unknown>;
  remainingAmount: number;
  sourceMode: 'manual' | 'auto_debit';
  userId: string;
};

export function SavingsPlanCardContribution(props: Props) {
  const [expanded, setExpanded] = useState(props.sourceMode === 'auto_debit');
  const contribution = useSavingsCardContribution(props);
  const selectedMethod = contribution.methods.find(
    (method) => method.id === contribution.selectedMethodId
  );
  const canStart =
    contribution.enabled &&
    !contribution.loading &&
    !contribution.busy &&
    !contribution.operation &&
    contribution.methods.length > 0;
  const invalidAmount =
    props.amount.trim() !== '' &&
    (contribution.amountKobo === null ||
      contribution.amountKobo > contribution.limitKobo);
  const showSavedCardContribution = Boolean(
    contribution.enabled || contribution.snapshot || contribution.operation
  );
  return (
    <>
      {showSavedCardContribution ? (
        <SavingsPlanCardContributionView
          amount={props.amount}
          amountKobo={contribution.amountKobo}
          amountLabel={
            contribution.amountKobo
              ? savingsCardContributionUtils.formatAmount(
                  contribution.amountKobo
                )
              : ''
          }
          allowRetry={contribution.allowRetry}
          busy={contribution.busy}
          canStart={canStart}
          canStartNew={contribution.canStartNew}
          capabilityLoaded={contribution.capabilityLoaded}
          colors={props.colors}
          enabled={contribution.enabled}
          expanded={expanded}
          invalidAmount={invalidAmount}
          loading={contribution.loading}
          message={contribution.message}
          methods={contribution.methods}
          onAmountChange={props.onAmountChange}
          onCancelReview={() => contribution.setReviewing(false)}
          onCheckStatus={() => void contribution.readStatus()}
          onConfirm={() => void contribution.beginContribution()}
          onNewContribution={() => void contribution.beginNewContribution()}
          onRetry={() => void contribution.retryContribution()}
          onReview={() => contribution.setReviewing(true)}
          onSelectMethod={contribution.selectMethod}
          onToggle={() => setExpanded(!expanded)}
          operationStatus={contribution.operation?.status ?? null}
          reviewing={contribution.reviewing}
          selectedMethod={selectedMethod}
          selectedMethodId={contribution.selectedMethodId}
          snapshot={contribution.snapshot}
          sourceMode={props.sourceMode}
        />
      ) : null}
      <SavingsFirstCardCheckout
        colors={props.colors}
        goalId={props.goalId}
        merchantId={props.merchantId}
        onCompleted={contribution.refreshMethods}
        onRefreshWallet={props.onRefreshWallet}
        remainingAmount={props.remainingAmount}
        userId={props.userId}
      />
    </>
  );
}

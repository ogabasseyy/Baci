import { useState } from 'react';
import { Text, View } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { handleSavingsActionError } from './handle-savings-action-error';
import { PlanFundingAccountDetails } from './PlanFundingAccountDetails';
import { PlanFundingFallback } from './PlanFundingFallback';
import { PlanFundingLookup } from './PlanFundingLookup';
import { PlanTransferActions } from './PlanTransferActions';
import { startSavingsStyles as styles } from './start-savings.styles';
import { SummaryRow } from './start-savings-modal-parts';
import type { TransferModalProps } from './start-savings-transfer-modal-props';

export function PlanTransferMode({ colors, controller }: TransferModalProps) {
  const [bvn, setBvn] = useState('');
  const [earnInterest, setEarnInterest] = useState(false);
  // Direct plan-account transfers bypass the wallet entirely: the amount is
  // the persisted initial contribution, not the wallet top-up shortfall.
  const transferAmount = controller.effectiveInitialContribution;
  const phase = controller.planFundingPhase;

  const handleFetchPlanAccount = async () => {
    try {
      await controller.fetchPlanFunding(bvn, {
        enableInterestAccrual: earnInterest,
      });
    } catch (error) {
      handleSavingsActionError(
        error,
        'Unable to load plan account',
        'Failed to load the plan account. Please try again.'
      );
    }
  };

  const handleConfirmTransfer = async () => {
    try {
      await controller.confirmPlanTransfer();
    } catch (error) {
      handleSavingsActionError(
        error,
        'Unable to confirm transfer',
        'Failed to confirm the transfer. Please try again.'
      );
    }
  };

  const handleContributeFromWallet = async () => {
    try {
      await controller.submitBankTransferContribution();
    } catch (error) {
      handleSavingsActionError(
        error,
        'Unable to record contribution',
        'Failed to record the contribution. Please try again.'
      );
    }
  };

  return (
    <ModalSheet
      visible={controller.showTransferModal}
      animationType="slide"
      backdropStyle={styles.modalBackdrop}
      cardStyle={[styles.modalCard, { backgroundColor: colors.background }]}
    >
      <Text style={[styles.modalTitle, { color: colors.text }]}>
        Fund your plan to continue
      </Text>
      <View
        style={[
          styles.transferCard,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        <SummaryRow
          label="Transfer amount"
          value={formatNgnCurrency(transferAmount)}
          colors={colors}
        />
        {phase === 'ready' ? (
          <PlanFundingAccountDetails
            account={controller.planFundingAccounts[0]}
            colors={colors}
          />
        ) : (
          <PlanFundingLookup
            colors={colors}
            controller={controller}
            bvn={bvn}
            earnInterest={earnInterest}
            onBvnChange={setBvn}
            onEarnInterestChange={setEarnInterest}
            onFetch={handleFetchPlanAccount}
          />
        )}
        {phase === 'pending' ? (
          <Text
            style={[
              styles.emptyFundingAccountText,
              { color: colors.textSecondary },
            ]}
          >
            Your dedicated account is being prepared. Check again shortly.
          </Text>
        ) : null}
        {phase === 'unavailable' || phase === 'error' ? (
          <PlanFundingFallback colors={colors} controller={controller} />
        ) : null}
      </View>
      <PlanTransferActions
        colors={colors}
        controller={controller}
        onConfirmTransfer={handleConfirmTransfer}
        onContributeFromWallet={handleContributeFromWallet}
      />
    </ModalSheet>
  );
}

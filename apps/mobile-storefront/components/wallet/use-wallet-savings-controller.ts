import { Alert } from 'react-native';
import { usePrimarySavingsRecovery } from './use-primary-savings-recovery';
import { createWalletSavingsActions } from './use-wallet-savings-actions';

export function useWalletSavingsController(
  input: Parameters<typeof createWalletSavingsActions>[0] & { userId?: string }
) {
  const recovery = usePrimarySavingsRecovery({
    merchantId: input.activeMerchantId,
    userId: input.userId,
    goalId: input.goal?.id,
    operationRef: input.idempotencyKeyRef,
    setAmount: input.setSavingsContributionAmount,
  });
  const actions = createWalletSavingsActions(input);
  const retryRecovery = () => {
    recovery.retry();
    Alert.alert(
      'Checking contributions',
      'We need to check for an existing transfer before starting another payment. Please try again after this check.'
    );
  };
  return {
    ...actions,
    hasPendingSavingsContribution:
      recovery.ready && actions.hasPendingSavingsContribution,
    handleAddSavingsContribution: recovery.ready
      ? actions.handleAddSavingsContribution
      : retryRecovery,
    handleFundSavingsWallet: recovery.ready
      ? actions.handleFundSavingsWallet
      : retryRecovery,
  };
}

import { Alert } from 'react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { checkPiggyvestPrimarySavingsStatus } from '@/lib/piggyvest-primary-savings-status';
import { trackSavingsContribution } from '@/services/track-savings-contribution';

export async function checkPendingPrimarySavings(input: {
  merchantId?: string;
  goal?: WalletActiveSavingsGoal | null;
  refreshGoal?: () => Promise<WalletActiveSavingsGoal | null>;
  operationId: string;
  clearOperation: () => void;
  clearAmount: () => void;
  refetchWallet: () => Promise<unknown>;
  setPending: (value: boolean) => void;
}) {
  input.setPending(true);
  try {
    const readStatus = () =>
      checkPiggyvestPrimarySavingsStatus({
        merchantId: input.merchantId,
        operationId: input.operationId,
      });
    const result = input.goal
      ? await trackSavingsContribution(
          input.goal,
          readStatus,
          input.refreshGoal
        )
      : await readStatus();
    if (result.status === 'confirmed') {
      input.clearOperation();
      input.clearAmount();
      await input.refetchWallet().catch(() => undefined);
      Alert.alert(
        'Savings updated',
        'PiggyVest has confirmed your contribution. Your savings balance has been updated.'
      );
    } else if (result.status === 'cancelled') {
      input.clearOperation();
      await input.refetchWallet().catch(() => undefined);
      Alert.alert(
        'Contribution cancelled',
        'The transfer was cancelled before submission and your reserved wallet funds were released.'
      );
    } else
      Alert.alert(
        'Contribution pending',
        'Your savings will update after PiggyVest confirms the transfer. No new payment has been started.'
      );
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'CONTRIBUTION_NOT_FOUND'
    ) {
      // Authoritative absence: the server joins the status read to the
      // caller's own intent, so not_found means this identity never
      // reserved this operation id (the initial POST died on CSRF,
      // transport, or early 503 — never a cross-identity leak, and the
      // controller drops the key on scope change before any foreign
      // query). Release the local operation and let the next tap
      // re-submit. The entered amount is kept. Ambiguous failures still
      // retain the operation for recovery.
      input.clearOperation();
      Alert.alert(
        'Contribution not received',
        'PiggyVest has no record of this contribution. You can safely try again.'
      );
      return;
    }
    Alert.alert(
      'Status unavailable',
      'Could not confirm this contribution. Refresh its status later before starting another payment.'
    );
  } finally {
    input.setPending(false);
  }
}

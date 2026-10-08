import { Alert } from 'react-native';
import { checkPiggyvestPrimarySavingsStatus } from '@/lib/piggyvest-primary-savings-status';

export async function checkPendingPrimarySavings(input: {
  merchantId?: string;
  operationId: string;
  clearOperation: () => void;
  clearAmount: () => void;
  refetchWallet: () => Promise<unknown>;
  setPending: (value: boolean) => void;
}) {
  input.setPending(true);
  try {
    const result = await checkPiggyvestPrimarySavingsStatus({
      merchantId: input.merchantId,
      operationId: input.operationId,
    });
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
  } catch {
    Alert.alert(
      'Status unavailable',
      'Could not confirm this contribution. Refresh its status later before starting another payment.'
    );
  } finally {
    input.setPending(false);
  }
}

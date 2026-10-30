import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';

export function openSavingsWalletFunding(input: {
  goalId: string;
  amount: number;
  requiredTopUpAmount: number;
}): void {
  router.replace({
    pathname: '/wallet',
    params: {
      action: 'bank-transfer',
      intent: Crypto.randomUUID(),
      requiredAmount: String(Math.max(0, input.requiredTopUpAmount)),
      returnTo: `/wallet?action=savings&savingsGoalId=${encodeURIComponent(input.goalId)}&savingsAmount=${encodeURIComponent(String(input.amount))}`,
    },
  });
}

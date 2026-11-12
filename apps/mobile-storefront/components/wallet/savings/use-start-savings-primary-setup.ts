import { useState } from 'react';
import { setupExistingSavingsGoal } from '@/lib/customer-savings';

/**
 * PiggyVest-only parts of the savings form. The interest question is asked
 * on the form (not after the plan exists), and once the plan is created its
 * savings wallet setup starts straight away with that answer. Auto debit
 * (scheduled Paystack card charges) is never offered: card money does not go
 * into PiggyVest, so manual saving is the only choice for now.
 */
export function useStartSavingsPrimarySetup({
  activeMerchantId,
  primaryWallet,
}: {
  activeMerchantId?: string;
  primaryWallet: boolean;
}) {
  const [interestChoice, setInterestChoice] = useState<boolean | null>(null);
  const startGoalWalletSetup =
    primaryWallet && interestChoice !== null
      ? (goalId: string) =>
          setupExistingSavingsGoal({
            goalId,
            merchantId: activeMerchantId,
            interestAccepted: interestChoice,
          })
      : undefined;
  return {
    allowAutoDebit: !primaryWallet,
    askInterest: primaryWallet,
    interestChoice,
    setInterestChoice,
    startGoalWalletSetup,
  };
}

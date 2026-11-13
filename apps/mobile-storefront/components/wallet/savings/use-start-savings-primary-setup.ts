import { useState } from 'react';
import type { WalletData } from '@/hooks/wallet-query';
import { setupExistingSavingsGoal } from '@/lib/customer-savings';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';

/**
 * PiggyVest-only parts of the savings form. The interest question is asked
 * on the form (not after the plan exists), and once the plan is created its
 * savings wallet setup starts straight away with that answer. Auto debit
 * (scheduled Paystack card charges) is offered only once the wallet is
 * confirmed legacy: never for PiggyVest (card money never goes into
 * PiggyVest) and never while the wallet type is still unknown. The interest
 * answer belongs to the signed-in account and is cleared on a switch.
 */
export function useStartSavingsPrimarySetup({
  activeMerchantId,
  primaryWallet,
  userId,
  wallet,
}: {
  activeMerchantId?: string;
  primaryWallet: boolean;
  userId?: string;
  /** The wallet read; undefined while loading. */
  wallet?: WalletData;
}) {
  // Known once the wallet read has answered and was not unavailable.
  const walletKnown =
    wallet !== undefined && wallet.primary_unavailable !== true;
  // PiggyVest when the wallet says so or the merchant is a PiggyVest one:
  // the form, review and submit all use this one answer (askInterest).
  const primary = primaryWallet || isPiggyvestPrimaryMerchant(activeMerchantId);
  const [answer, setAnswer] = useState<{
    userId?: string;
    value: boolean | null;
  }>({ userId, value: null });
  // A different signed-in account starts with no answer, and switching back
  // never brings an earlier answer back: the stored one is cleared, not
  // just hidden.
  if (answer.userId !== userId) setAnswer({ userId, value: null });
  const interestChoice = answer.userId === userId ? answer.value : null;
  const setInterestChoice = (value: boolean) => setAnswer({ userId, value });
  const startGoalWalletSetup =
    primary && typeof interestChoice === 'boolean'
      ? (goalId: string) =>
          setupExistingSavingsGoal({
            goalId,
            merchantId: activeMerchantId,
            interestAccepted: interestChoice,
          })
      : undefined;
  return {
    allowAutoDebit: !primary && walletKnown,
    askInterest: primary,
    /** For the form check: undefined when interest is not asked. */
    formInterestChoice: primary ? interestChoice : undefined,
    interestChoice,
    setInterestChoice,
    startGoalWalletSetup,
  };
}

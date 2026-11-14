import { useState } from 'react';
import { usePiggyvestCapabilityNow } from '@/hooks/use-piggyvest-capability-now';
import type { WalletData } from '@/hooks/wallet-query';
import { setupExistingSavingsGoal } from '@/lib/customer-savings';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { wasPiggyvestLastRuledOut } from '@/lib/piggyvest-primary-capability-cache';

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
  // Known once the wallet read has answered and was not unavailable. At the
  // PiggyVest merchant a wallet with no owner yet stays unknown (Codex);
  // other merchants keep today's rule.
  const pilot = isPiggyvestPrimaryMerchant(activeMerchantId);
  const walletKnown =
    wallet !== undefined &&
    wallet.primary_unavailable !== true &&
    !(pilot && wallet.owner_unresolved === true);
  // A confirmed PiggyVest account whose balance isn't ready yet is PiggyVest
  // (Codex), never a known legacy wallet.
  const primaryPending = wallet?.primary_pending === true;
  // PiggyVest when the wallet says so. The merchant only decides while the
  // customer's own wallet type is still unknown; once the read shows a
  // legacy wallet, that customer stays on the legacy rail. The form, review
  // and submit all use this one answer (askInterest).
  // A live ruling-out wins (Codex): a cached PiggyVest wallet whose
  // reclassification refetch is slow or failing must not keep the PiggyVest
  // form (interest, no auto debit, goal-wallet setup) after a rollback.
  const verdictNow = usePiggyvestCapabilityNow(activeMerchantId);
  // Also once that ruling-out has expired, until a fresh positive verdict
  // (Codex): the wallet screen keeps the balance suppressed meanwhile.
  const ruledOut =
    verdictNow === false ||
    (verdictNow === null &&
      !!activeMerchantId &&
      wasPiggyvestLastRuledOut(activeMerchantId));
  const primary =
    !ruledOut && (primaryWallet || primaryPending || (!walletKnown && pilot));
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

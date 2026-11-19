import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { UtilityPaymentOptions } from './UtilityPaymentOptions';
import { useRetainsPiggyvest } from './use-retains-piggyvest';
import type { UtilityRetainedAttempt } from './use-utility-retained-attempt';

/**
 * The data form's payment section: the shared utility options plus whether
 * this exact bundle purchase has a retained store credit attempt (the same
 * retry identity the submit handler peeks at), so a replay on store credit
 * is never shown as paid from the savings wallet.
 */
export function DataPaymentOptions({
  payment,
  planAmount,
  selectedPlan,
  selectedProvider,
  phoneNumber,
  retained,
  returnToHref,
}: {
  payment: ReturnType<typeof useUtilityPayment>;
  planAmount: number;
  selectedPlan: string | null | undefined;
  selectedProvider: string | null | undefined;
  phoneNumber: string;
  /** The form's shared kept-attempt answer, when it has one. */
  retained?: UtilityRetainedAttempt;
  returnToHref: WalletReturnHref;
}) {
  const request = {
    amount: planAmount,
    dataPlanCode: selectedPlan ?? undefined,
    networkProvider: selectedProvider ?? undefined,
    phoneNumber,
    type: 'data' as const,
    walletAmount: planAmount,
  };
  // The form's shared lookup when given (the Pay gate reads the same one);
  // otherwise this section looks up the kept attempt itself.
  const ownPiggyvest = useRetainsPiggyvest(
    retained || planAmount <= 0 ? null : request
  );
  const retainedStoreCredit = retained
    ? retained.retainedStoreCredit
    : planAmount > 0 && payment.hasRetainedVtuAttempt?.(request) === true;
  const retainedPiggyvest = retained
    ? retained.retainedPiggyvest
    : ownPiggyvest;
  return (
    <UtilityPaymentOptions
      amount={planAmount}
      canFundByBankTransfer={payment.canFundByBankTransfer}
      returnToHref={returnToHref}
      walletBalance={payment.getWalletBalance()}
      walletError={payment.walletError}
      walletIsLoading={payment.walletIsLoading}
      walletIsSettled={payment.isWalletSettled()}
      walletIsStoreCredit={payment.walletIsStoreCredit}
      walletPrimaryUnknown={payment.walletPrimaryUnknown}
      retainedStoreCredit={retainedStoreCredit}
      retainedPiggyvest={retainedPiggyvest}
    />
  );
}

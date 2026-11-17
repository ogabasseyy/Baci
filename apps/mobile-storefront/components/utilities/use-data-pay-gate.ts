import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { useUtilityPayGate } from './use-utility-pay-gate';
import {
  isRetainedForPay,
  type UtilityRetainedAttempt,
  useUtilityRetainedAttempt,
} from './use-utility-retained-attempt';
import {
  getDataFormIssue,
  getFieldIssuePointer,
  type UtilityFormIssue,
} from './utility-form-issue';

/**
 * The data form's Pay gate: the form issue (shown at its field when it is
 * `inline`, otherwise above Pay) and, once the form is complete, whether the
 * chosen payment method covers the bundle. The retry identity matches the
 * one the payment section and the submit handler use.
 */
export function useDataPayGate({
  payment,
  phoneNumber,
  planAmount,
  returnToHref,
  selectedPlan,
  selectedProvider,
}: {
  payment: ReturnType<typeof useUtilityPayment>;
  phoneNumber: string;
  planAmount: number;
  returnToHref: WalletReturnHref;
  selectedPlan: string | null | undefined;
  selectedProvider: string | null | undefined;
}): {
  blockedReason: string | null;
  inlineIssue: UtilityFormIssue | null;
  /** The one kept-attempt answer, shared with the payment section. */
  retained: UtilityRetainedAttempt;
  notice: {
    action: { label: string; onPress: () => void } | null;
    message: string;
  } | null;
} {
  const retained = useUtilityRetainedAttempt(
    payment,
    planAmount > 0
      ? {
          amount: planAmount,
          dataPlanCode: selectedPlan ?? undefined,
          networkProvider: selectedProvider ?? undefined,
          phoneNumber,
          type: 'data',
          walletAmount: planAmount,
        }
      : null
  );
  const formIssue = getDataFormIssue({
    phoneNumber,
    planAmount,
    selectedPlan,
    selectedProvider,
  });
  const gate = useUtilityPayGate({
    amount: planAmount,
    formIssue: formIssue?.message ?? null,
    payment,
    retained: isRetainedForPay(retained),
    returnToHref,
  });
  const inlineIssue = formIssue?.inline ? formIssue : null;
  return {
    blockedReason: gate.blockedReason,
    inlineIssue,
    retained,
    notice: inlineIssue
      ? { action: null, message: getFieldIssuePointer(inlineIssue.field) }
      : gate.blockedReason
        ? { action: gate.action, message: gate.blockedReason }
        : null,
  };
}

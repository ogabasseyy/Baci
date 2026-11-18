import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import type { VtuWalletPayRequest } from '@/lib/wallet-pay/vtu-wallet-pay-api';
import { useUtilityPayGate } from './use-utility-pay-gate';
import {
  isRetainedForPay,
  type UtilityRetainedAttempt,
  useUtilityRetainedAttempt,
} from './use-utility-retained-attempt';
import { getFieldIssuePointer } from './utility-form-issue';

/**
 * The bill form's Pay gate: the amount issue (shown under the amount field
 * once something is typed, with a pointer to it above Pay) and, once the
 * amount is valid, whether the chosen payment method covers it. The retry
 * identity is the exact request the submit builds.
 */
export function useBillPayGate({
  amountIssue,
  formattedAmount,
  numericAmount,
  payment,
  purchaseRequest,
  returnToHref,
}: {
  amountIssue: string | null;
  formattedAmount: string;
  numericAmount: number;
  payment: ReturnType<typeof useUtilityPayment>;
  purchaseRequest: VtuWalletPayRequest | null | undefined;
  returnToHref: WalletReturnHref;
}): {
  blockedReason: string | null;
  /** The one kept-attempt answer, shared with the payment section. */
  retained: UtilityRetainedAttempt;
  notice: {
    action: { label: string; onPress: () => void } | null;
    message: string;
  } | null;
} {
  const retained = useUtilityRetainedAttempt(payment, purchaseRequest ?? null);
  const gate = useUtilityPayGate({
    amount: numericAmount,
    formIssue: amountIssue,
    payment,
    retained: isRetainedForPay(retained),
    returnToHref,
  });
  // An amount issue is shown under the amount field once something is typed.
  const amountIssueInline = Boolean(amountIssue && formattedAmount);
  return {
    blockedReason: gate.blockedReason,
    retained,
    notice: amountIssueInline
      ? { action: null, message: getFieldIssuePointer('amount') }
      : gate.blockedReason
        ? { action: gate.action, message: gate.blockedReason }
        : null,
  };
}

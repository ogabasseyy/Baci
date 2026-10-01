'use client';

import { useCheckoutOrderSubmission } from './use-checkout-order-submission';
import type { CheckoutOrderSubmissionContext } from './checkout-order-submission-types';
import { useWalletFundedBankTransfer } from './use-wallet-funded-bank-transfer';
import { useWalletFundedOrderCompletion } from './use-wallet-funded-order-completion';

type CompletionContext = Omit<
  Parameters<typeof useWalletFundedOrderCompletion>[0],
  'paymentMethod'
> & { paymentMethod: string };
type TransferContext = Omit<
  Parameters<typeof useWalletFundedBankTransfer>[0],
  'onOrderPaid'
>;
type SubmissionContext = Omit<CheckoutOrderSubmissionContext, 'order'> & {
  order: Omit<CheckoutOrderSubmissionContext['order'], 'walletFundedTransfer'>;
};

/** Owns payment execution wiring while leaving the financial session authoritative. */
export function useCheckoutPaymentExecution({
  completion,
  transfer,
  submission,
}: {
  completion: CompletionContext;
  transfer: TransferContext;
  submission: SubmissionContext;
}) {
  const completeWalletFundedOrder = useWalletFundedOrderCompletion(completion);
  const walletFundedTransfer = useWalletFundedBankTransfer({
    ...transfer,
    onOrderPaid: completeWalletFundedOrder,
  });
  const { handlePlaceOrder } = useCheckoutOrderSubmission({
    ...submission,
    order: { ...submission.order, walletFundedTransfer },
  });

  return { handlePlaceOrder, walletFundedTransfer };
}

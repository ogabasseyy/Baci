import { finalizeCheckoutPayment } from './checkout-payment-finalization';

type FinalizeCheckoutPaymentInput = Parameters<
  typeof finalizeCheckoutPayment
>[0];

export function runFinalizeCheckoutPayment(
  input: FinalizeCheckoutPaymentInput,
  finalize = finalizeCheckoutPayment
) {
  return finalize(input);
}

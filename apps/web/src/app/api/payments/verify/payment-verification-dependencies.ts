import type { finalizeVerificationResponse } from './finalize-verification-response';
import type { loadPaymentVerificationTransaction } from './load-payment-verification-transaction';

export type PaymentVerificationDependencies = {
  load: (
    reference: string
  ) => ReturnType<typeof loadPaymentVerificationTransaction>;
  finalize: (
    input: Parameters<typeof finalizeVerificationResponse>[0]
  ) => ReturnType<typeof finalizeVerificationResponse>;
};

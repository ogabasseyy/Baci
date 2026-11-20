import 'server-only';
import { verifyTransaction } from '@/lib/paystack';
import {
  type BankCardOfferAttempt,
  verifyBankCardOfferAttempt,
} from './bank-card-offer-payment';

export async function verifyBankCardOfferPaystack(
  attempt: BankCardOfferAttempt
) {
  const response = await verifyTransaction(attempt.reference, undefined, {
    textIds: true,
  });
  if (!response.success) return null;
  const { data } = response;
  const status = String(data.status);
  if (data.reference !== attempt.reference)
    return status === 'success' ? ({ kind: 'mismatch' } as const) : null;
  if (status !== 'success') {
    // A terminal status starts operator review for the same reference.
    // Only a successful capture can establish and approve the amount paid.
    if (
      status === 'failed' ||
      status === 'abandoned' ||
      status === 'cancelled'
    ) {
      return 'domain' in data &&
        data.domain === attempt.domain &&
        data.currency.toUpperCase() === attempt.currency
        ? ({ kind: 'terminal', status } as const)
        : ({ kind: 'mismatch' } as const);
    }
    return null;
  }
  const evidence = verifyBankCardOfferAttempt(attempt, {
    status: true,
    data: response.data,
  });
  return evidence
    ? ({
        kind: 'verified',
        evidence,
        gatewayResponse: { ...response.data },
      } as const)
    : ({ kind: 'mismatch' } as const);
}

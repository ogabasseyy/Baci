import 'server-only';
import { verifyTransaction } from '@/lib/paystack';
import {
  type BankCardOfferAttempt,
  verifyBankCardOfferAttempt,
} from './bank-card-offer-payment';

export async function verifyBankCardOfferPaystack(
  attempt: BankCardOfferAttempt,
  signal?: AbortSignal
) {
  const response = await verifyTransaction(attempt.reference, signal, {
    textIds: true,
  });
  if (!response.success) {
    const errorMessage = response.error?.trim().toLowerCase();
    const referenceNotFound =
      response.code === 'HTTP_404' ||
      ((response.code === 'HTTP_400' || response.code === 'HTTP_200') &&
        (errorMessage === 'transaction reference not found' ||
          errorMessage === 'transaction not found'));
    // A missing lookup flags evidence for review. Only a verified terminal
    // transaction can enter the attempt retirement path.
    return referenceNotFound ? ({ kind: 'mismatch' } as const) : null;
  }
  const { data } = response;
  if (!data || typeof data !== 'object' || typeof data.status !== 'string') {
    return { kind: 'mismatch' } as const;
  }
  const status: string = data.status;
  const terminal =
    status === 'failed' ||
    status === 'abandoned' ||
    status === 'reversed' ||
    status === 'cancelled';
  if (data.reference !== attempt.reference) {
    return { kind: 'mismatch' } as const;
  }
  if (status !== 'success') {
    // A terminal status starts operator review for the same reference.
    // Only a successful capture can establish and approve the amount paid.
    if (terminal) {
      return 'domain' in data &&
        data.domain === attempt.domain &&
        typeof data.currency === 'string' &&
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

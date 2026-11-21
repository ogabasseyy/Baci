import 'server-only';
import { verifyTransaction } from '@/lib/paystack';
import { bankCardOfferTerminalStatusSchema } from '@/schemas/bank-card-offer-reference';
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
  // A provider lookup without transaction data cannot prove a mismatch
  // or a terminal outcome. Keep the same attempt pending for verification.
  if (!response.success) return null;
  const { data } = response;
  if (!data || typeof data !== 'object' || typeof data.status !== 'string') {
    return { kind: 'mismatch' } as const;
  }
  const status: string = data.status;
  const terminal = bankCardOfferTerminalStatusSchema.safeParse(status);
  if (data.reference !== attempt.reference) {
    return { kind: 'mismatch' } as const;
  }
  if (status !== 'success') {
    // A terminal status starts operator review for the same reference.
    // Only a successful capture can establish and approve the amount paid.
    if (terminal.success) {
      return 'domain' in data &&
        data.domain === attempt.domain &&
        typeof data.currency === 'string' &&
        data.currency.toUpperCase() === attempt.currency
        ? ({ kind: 'terminal', status: terminal.data } as const)
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

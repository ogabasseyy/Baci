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
  // A missing transaction still needs the same reference checked later.
  // Transport failures additionally tell the caller to back off.
  if (!response.success) {
    const code = response.code;
    return code === 'NETWORK_ERROR' ||
      code === 'CONFIG_ERROR' ||
      code === 'HTTP_408' ||
      code === 'HTTP_429' ||
      code?.startsWith('HTTP_5')
      ? ({ kind: 'unavailable' } as const)
      : null;
  }
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
    // Terminal evidence only holds the exact reference for review. Its
    // amount may describe a partial reversal, so requiring the original
    // amount here could hide a legitimate reversal. Successful capture
    // approval below still requires the full saved amount.
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

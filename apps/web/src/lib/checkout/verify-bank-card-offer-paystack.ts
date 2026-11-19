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
  return verifyBankCardOfferAttempt(attempt, {
    status: true,
    data: response.data,
  });
}

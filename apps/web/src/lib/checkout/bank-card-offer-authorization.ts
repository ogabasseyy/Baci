import 'server-only';
import { createPaystackCardOfferMetadata } from '@/lib/payments/create-paystack-card-offer-metadata';
import { bankCardOfferAttemptMatchesQuote } from './bank-card-offer-attempt-matches-quote';
import type { BankCardOfferAttempt } from './bank-card-offer-payment';
import { hashBankCardOfferFilter } from './hash-bank-card-offer-filter';

export function bankCardOfferAuthorization(attempt: BankCardOfferAttempt) {
  if (!bankCardOfferAttemptMatchesQuote(attempt)) {
    throw new Error('Bank offer payable amount does not match the saved quote');
  }
  const policy = attempt.quote.paymentPolicy;
  if (attempt.acceptedFilterPolicyHash !== hashBankCardOfferFilter(policy)) {
    throw new Error('Bank offer filter does not match the saved attempt');
  }
  return createPaystackCardOfferMetadata({
    ...policy,
    cardBrands: [...policy.cardBrands].sort(),
  });
}

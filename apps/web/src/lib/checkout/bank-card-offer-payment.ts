import 'server-only';
import { logger } from '@/lib/logger';
import { verifyPaystackCardOffer } from '@/lib/payments/paystack-card-offer';
import { bankCardOfferAttemptMatchesQuote } from './bank-card-offer-attempt-matches-quote';
import type { quoteBankCardOffer } from './bank-card-offer-quote';
import { hashBankCardOfferFilter } from './hash-bank-card-offer-filter';

export type BankCardOfferQuote = NonNullable<
  ReturnType<typeof quoteBankCardOffer>
>;

// The order and attempt store must persist this context before contacting
// Paystack. Settlement uses the captured values even if offer terms change.
export type BankCardOfferAttempt = {
  quote: BankCardOfferQuote;
  acceptedFilterPolicyHash: string;
  amountKobo: number;
  adjustmentsKobo: number;
  currency: 'NGN';
  customerEmail: string;
  domain: 'live' | 'test';
  reference: string;
};

export function verifyBankCardOfferAttempt(
  attempt: BankCardOfferAttempt,
  verifyResponse: unknown
) {
  if (
    !bankCardOfferAttemptMatchesQuote(attempt) ||
    attempt.acceptedFilterPolicyHash !==
      hashBankCardOfferFilter(attempt.quote.paymentPolicy)
  ) {
    return null;
  }
  return verifyPaystackCardOffer({
    acceptedFilterPolicyHash: attempt.acceptedFilterPolicyHash,
    cardBrands: attempt.quote.paymentPolicy.cardBrands,
    expectedAmountKobo: attempt.amountKobo,
    expectedCurrency: attempt.currency,
    expectedCustomerEmail: attempt.customerEmail,
    expectedDomain: attempt.domain,
    expectedIssuerName: attempt.quote.paymentPolicy.issuerName,
    expectedBankCode: attempt.quote.paymentPolicy.bankCode,
    expectedReference: attempt.reference,
    onIssuerMismatch: (issuer) => {
      const label = issuer.trim();
      logger.warn({
        message: 'Paystack issuer label does not match the saved bank offer',
        bankCode: attempt.quote.paymentPolicy.bankCode,
        // Keep the label useful without emitting control characters, IDs, or card data.
        ...(/^[A-Za-z .&'()-]{1,80}$/.test(label) && { issuer: label }),
      });
    },
    verifyResponse,
  });
}

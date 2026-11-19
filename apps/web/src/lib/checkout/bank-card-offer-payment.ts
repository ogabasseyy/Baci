import 'server-only';
import { createHash } from 'node:crypto';
import { allocateRedvaultRefund } from '@baci/shared/lib';
import {
  createPaystackCardOfferMetadata,
  verifyPaystackCardOffer,
} from '@/lib/payments/paystack-card-offer';
import type { quoteBankCardOffer } from './bank-card-offer-quote';

type BankCardOfferQuote = NonNullable<ReturnType<typeof quoteBankCardOffer>>;

// The order and attempt store must persist this context before contacting
// Paystack. Settlement uses the captured values even if offer terms change.
type BankCardOfferAttempt = {
  quote: BankCardOfferQuote;
  acceptedFilterPolicyHash: string;
  amountKobo: number;
  currency: 'NGN';
  customerEmail: string;
  domain: 'live' | 'test';
  reference: string;
};

export function hashBankCardOfferFilter(
  policy: BankCardOfferQuote['paymentPolicy']
) {
  const metadata = createPaystackCardOfferMetadata({
    ...policy,
    cardBrands: [...policy.cardBrands].sort(),
  });
  return createHash('sha256')
    .update(
      JSON.stringify({ version: 1, metadata, issuerName: policy.issuerName })
    )
    .digest('hex');
}

export function bankCardOfferAuthorization(attempt: BankCardOfferAttempt) {
  const policy = attempt.quote.paymentPolicy;
  if (attempt.acceptedFilterPolicyHash !== hashBankCardOfferFilter(policy)) {
    throw new Error('Bank offer filter does not match the saved attempt');
  }
  return createPaystackCardOfferMetadata(policy);
}

export function verifyBankCardOfferAttempt(
  attempt: BankCardOfferAttempt,
  verifyResponse: unknown
) {
  if (
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
    expectedReference: attempt.reference,
    verifyResponse,
  });
}

export function calculateBankCardOfferMerchandiseRefund({
  quote,
  itemId,
  returnedUnitIndexes,
}: {
  quote: BankCardOfferQuote;
  itemId: string;
  returnedUnitIndexes: readonly number[];
}) {
  const allocation = quote.allocations.find((item) => item.itemId === itemId);
  if (!allocation)
    throw new Error('Refund item is outside the bank offer quote');
  return allocateRedvaultRefund(allocation, returnedUnitIndexes);
}

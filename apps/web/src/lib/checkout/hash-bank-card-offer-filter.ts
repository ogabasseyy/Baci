import 'server-only';
import { createHash } from 'node:crypto';
import { createPaystackCardOfferMetadata } from '@/lib/payments/create-paystack-card-offer-metadata';
import type { BankCardOfferQuote } from './bank-card-offer-payment';

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

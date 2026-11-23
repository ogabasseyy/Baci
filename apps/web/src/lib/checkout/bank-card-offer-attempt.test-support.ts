import { bankCardOfferContextFixture } from '@/schemas/bank-card-offer-payment-context.test-support';
import type { BankCardOfferAttempt } from './bank-card-offer-payment';
import { hashBankCardOfferFilter } from './hash-bank-card-offer-filter';

export const attemptFixture = {
  ...bankCardOfferContextFixture,
  acceptedFilterPolicyHash: hashBankCardOfferFilter(
    bankCardOfferContextFixture.quote.paymentPolicy
  ),
  adjustmentsKobo: 0,
  currency: 'NGN',
  domain: 'test',
  reference: `BCO-${'a'.repeat(32)}`,
} satisfies BankCardOfferAttempt;

export const captureFixture = {
  amount: attemptFixture.amountKobo,
  authorization: { bank: 'Wema Bank', brand: 'visa', channel: 'card' },
  channel: 'card',
  currency: 'NGN',
  customer: { email: attemptFixture.customerEmail },
  domain: 'test',
  id: '9007199254740993',
  paid_at: '2026-11-27T12:02:00Z',
  reference: attemptFixture.reference,
  status: 'success',
};

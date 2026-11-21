import 'server-only';
import { initializeTransaction } from '@/lib/paystack';
import { bankCardOfferCheckoutUrlSchema } from '@/schemas/bank-card-offer-checkout-url';
import { bankCardOfferAuthorization } from './bank-card-offer-authorization';
import type { BankCardOfferAttempt } from './bank-card-offer-payment';

export async function initializeBankCardOfferPaystack({
  attempt,
  callbackUrl,
  subaccount,
  transactionChargeKobo,
}: {
  // The caller must exclusively claim the persisted attempt before submission.
  attempt: BankCardOfferAttempt;
  callbackUrl: string;
  subaccount: string;
  transactionChargeKobo: number;
}) {
  const metadata = bankCardOfferAuthorization(attempt);
  const result = await initializeTransaction({
    amount: attempt.amountKobo,
    currency: attempt.currency,
    email: attempt.customerEmail,
    reference: attempt.reference,
    callback_url: callbackUrl,
    subaccount,
    transaction_charge: transactionChargeKobo,
    bearer: 'account',
    channels: ['card'],
    metadata,
  });
  const url = new URL(result.authorization_url);
  // The Paystack client returns the raw provider object after validation.
  // Amount and currency are optional on initialization and required at verification.
  if (
    result.reference !== attempt.reference ||
    ('amount' in result && result.amount !== attempt.amountKobo) ||
    ('currency' in result && result.currency !== attempt.currency) ||
    url.protocol !== 'https:' ||
    url.hostname !== 'checkout.paystack.com' ||
    url.username ||
    url.password ||
    url.port ||
    !bankCardOfferCheckoutUrlSchema.safeParse(url.href).success
  ) {
    throw new Error('Unverified bank offer initialization response');
  }
  return url.href;
}

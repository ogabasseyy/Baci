import type { BankCardOfferAttempt } from './bank-card-offer-payment';

export function bankCardOfferAttemptMatchesQuote(
  attempt: BankCardOfferAttempt
) {
  return (
    Number.isSafeInteger(attempt.adjustmentsKobo) &&
    attempt.adjustmentsKobo >= 0 &&
    Number.isSafeInteger(attempt.amountKobo) &&
    attempt.amountKobo >= 100 &&
    attempt.amountKobo ===
      attempt.quote.productSubtotalKobo -
        attempt.quote.discountKobo +
        attempt.adjustmentsKobo
  );
}

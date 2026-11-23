import { describe, expect, it } from 'vitest';
import { bankCardOfferAuthorization } from './bank-card-offer-authorization';
import { verifyBankCardOfferAttempt } from './bank-card-offer-payment';
import { quoteBankCardOffer } from './bank-card-offer-quote';
import {
  items,
  merchantId,
  now,
  offer,
} from './bank-card-offer-quote.test-support';
import { hashBankCardOfferFilter } from './hash-bank-card-offer-filter';

describe('bank card offer payment uses booked terms', () => {
  it.each([
    ['035', 'Wema Bank', '232', 'Sterling Bank'],
    ['232', 'Sterling Bank', '035', 'Wema Bank'],
  ] as const)('verifies the booked %s issuer after offer edits', (bankCode, issuerName, otherCode, otherIssuerName) => {
    const mutableOffer = {
      ...offer,
      bankCode,
      verifiedIssuerName: issuerName,
      cardBrands: [...offer.cardBrands],
    };
    const quote = quoteBankCardOffer({
      offer: mutableOffer,
      merchantId,
      items,
      now,
    });
    if (!quote) throw new Error('Expected an eligible order');
    const attempt = {
      quote,
      acceptedFilterPolicyHash: hashBankCardOfferFilter(quote.paymentPolicy),
      amountKobo: 22_500,
      adjustmentsKobo: 1499,
      currency: 'NGN' as const,
      customerEmail: 'buyer@example.test',
      domain: 'test' as const,
      reference: 'offer-test-1',
    };
    mutableOffer.verifiedIssuerName =
      bankCode === '035' ? 'Sterling Bank' : 'Wema Bank';
    mutableOffer.cardBrands.splice(0, 1, 'mastercard');
    mutableOffer.enabled = false;
    expect(bankCardOfferAuthorization(attempt).custom_filters).toEqual({
      banks: [bankCode],
      card_brands: ['visa'],
    });
    const verifiedData = {
      amount: attempt.amountKobo,
      currency: attempt.currency,
      customer: { email: attempt.customerEmail },
      domain: attempt.domain,
      reference: attempt.reference,
      channel: 'card',
      authorization: { bank: issuerName, brand: 'visa', channel: 'card' },
      id: 42,
      status: 'success',
      paid_at: '2026-11-28T12:00:00Z',
    };
    expect(
      verifyBankCardOfferAttempt(
        {
          ...attempt,
          quote: {
            ...quote,
            paymentPolicy: { ...quote.paymentPolicy, bankCode: otherCode },
          },
        },
        { status: true, data: verifiedData }
      )
    ).toBeNull();
    expect(
      verifyBankCardOfferAttempt(attempt, { status: true, data: verifiedData })
    ).toMatchObject({ issuerName, amountKobo: 22_500 });
    expect(
      verifyBankCardOfferAttempt(attempt, {
        status: true,
        data: { ...verifiedData, amount: 22_499 },
      })
    ).toBeNull();
    expect(
      verifyBankCardOfferAttempt(attempt, {
        status: true,
        data: {
          ...verifiedData,
          authorization: {
            ...verifiedData.authorization,
            bank: otherIssuerName,
          },
        },
      })
    ).toBeNull();
  });
});

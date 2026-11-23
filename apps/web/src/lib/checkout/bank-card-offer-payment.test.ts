import { expect, it } from 'vitest';
import {
  attemptFixture,
  captureFixture,
} from './bank-card-offer-attempt.test-support';
import { verifyBankCardOfferAttempt } from './bank-card-offer-payment';
import { hashBankCardOfferFilter } from './hash-bank-card-offer-filter';

it('accepts evidence tied to the saved amount, issuer and reference', () => {
  expect(
    verifyBankCardOfferAttempt(attemptFixture, {
      status: true,
      data: captureFixture,
    })
  ).toMatchObject({
    reference: attemptFixture.reference,
    amountKobo: 9500,
    issuerName: 'Wema Bank',
    providerVerificationId: captureFixture.id,
  });
});

it('rejects inconsistent captured amounts, issuer and saved filter', () => {
  expect(
    verifyBankCardOfferAttempt(attemptFixture, {
      status: true,
      data: { ...captureFixture, amount: 10_000 },
    })
  ).toBeNull();
  expect(
    verifyBankCardOfferAttempt(attemptFixture, {
      status: true,
      data: {
        ...captureFixture,
        authorization: {
          ...captureFixture.authorization,
          bank: 'Sterling Bank',
        },
      },
    })
  ).toBeNull();
  expect(
    verifyBankCardOfferAttempt(
      { ...attemptFixture, acceptedFilterPolicyHash: 'stale' },
      {
        status: true,
        data: captureFixture,
      }
    )
  ).toBeNull();
});

it.each([
  ['035', 'Wema Bank', 'WEMA BANK PLC.'],
  ['232', 'Sterling Bank', 'Sterling Bank Limited'],
] as const)('binds issuer aliases for bank %s to the canonical saved evidence', (bankCode, issuerName, providerIssuer) => {
  const paymentPolicy = {
    ...attemptFixture.quote.paymentPolicy,
    bankCode,
    issuerName,
  };
  const attempt = {
    ...attemptFixture,
    quote: { ...attemptFixture.quote, paymentPolicy },
    acceptedFilterPolicyHash: hashBankCardOfferFilter(paymentPolicy),
  };
  const result = verifyBankCardOfferAttempt(attempt, {
    status: true,
    data: {
      ...captureFixture,
      authorization: { ...captureFixture.authorization, bank: providerIssuer },
    },
  });

  expect(result).toMatchObject({
    issuerName,
    acceptedFilterPolicyHash: attempt.acceptedFilterPolicyHash,
  });
});

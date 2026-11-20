import { expect, it } from 'vitest';
import {
  attemptFixture,
  captureFixture,
} from './bank-card-offer-attempt.test-support';
import { verifyBankCardOfferAttempt } from './bank-card-offer-payment';

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

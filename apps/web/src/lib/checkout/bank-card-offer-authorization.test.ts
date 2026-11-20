import { expect, it } from 'vitest';
import { attemptFixture } from './bank-card-offer-attempt.test-support';
import { bankCardOfferAuthorization } from './bank-card-offer-authorization';

it('builds card filters for the bank saved on the attempt', () => {
  expect(bankCardOfferAuthorization(attemptFixture)).toEqual({
    partnership: 'black-friday',
    custom_filters: { banks: ['035'], card_brands: ['visa'] },
  });
});

it.each([
  [{ amountKobo: 9501 }, 'payable amount'],
  [{ acceptedFilterPolicyHash: 'stale-hash' }, 'filter does not match'],
] as const)('rejects an inconsistent attempt (%j)', (changes, error) => {
  expect(() =>
    bankCardOfferAuthorization({ ...attemptFixture, ...changes })
  ).toThrow(error);
});

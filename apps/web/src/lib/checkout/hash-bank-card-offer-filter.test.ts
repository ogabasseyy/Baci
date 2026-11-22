import { expect, it } from 'vitest';
import { bankCardOfferContextFixture } from '@/schemas/bank-card-offer-payment-context.test-support';
import { hashBankCardOfferFilter } from './hash-bank-card-offer-filter';

const policy: Parameters<typeof hashBankCardOfferFilter>[0] =
  bankCardOfferContextFixture.quote.paymentPolicy;

it('uses a stable hash regardless of card-brand order', () => {
  const first = hashBankCardOfferFilter({
    ...policy,
    cardBrands: ['visa', 'mastercard'],
  });
  const second = hashBankCardOfferFilter({
    ...policy,
    cardBrands: ['mastercard', 'visa'],
  });

  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(second).toBe(first);
});

it.each([
  { bankCode: '232' },
  { issuerName: 'Wema Bank Plc' },
  { partnership: 'another-offer' },
  { cardBrands: ['mastercard'] },
] satisfies Partial<
  typeof policy
>[])('binds the saved filter hash to %j', (change) => {
  expect(hashBankCardOfferFilter({ ...policy, ...change })).not.toBe(
    hashBankCardOfferFilter(policy)
  );
});

import { expect, it, vi } from 'vitest';
import { getBrowserBankCardOffers } from './get-browser-bank-card-offers';

vi.mock('@/config/bank-card-offers', () => ({
  BANK_CARD_OFFERS: [
    {
      id: 'wema',
      merchantId: 'one',
      enabled: true,
      approvedTermsReference: 'private',
      verifiedIssuerName: 'Wema Bank',
    },
    { id: 'sterling', merchantId: 'one', enabled: false },
    { id: 'other', merchantId: 'two', enabled: true },
  ],
}));

it('only returns enabled offers belonging to the merchant and keeps approval evidence server-side', () => {
  const offers = getBrowserBankCardOffers('ONE');
  expect(offers.map(({ id }) => id)).toEqual(['wema']);
  expect(offers[0]).not.toHaveProperty('approvedTermsReference');
});

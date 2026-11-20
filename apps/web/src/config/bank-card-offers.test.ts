import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('@/schemas/bank-card-offers');
  vi.resetModules();
});

it('ships without enabling any campaign before bank approval', async () => {
  const { BANK_CARD_OFFERS } = await import('./bank-card-offers');

  expect(BANK_CARD_OFFERS).toEqual([]);
});

it('disables the offer list if validation fails so shared checkout can load', async () => {
  vi.doMock('@/schemas/bank-card-offers', () => ({
    bankCardOffersSchema: { safeParse: () => ({ success: false }) },
  }));

  const { BANK_CARD_OFFERS } = await import('./bank-card-offers');

  expect(BANK_CARD_OFFERS).toEqual([]);
});

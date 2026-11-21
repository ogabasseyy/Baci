import { expect, it } from 'vitest';
import { createMockGiftCardWallet } from './mock-wallet';

it('returns the in-flight and final results without debiting twice', () => {
  const wallet = createMockGiftCardWallet(2_000_000);
  const quote = {
    id: 'fixture',
    cardId: '2844',
    totalKobo: 1673573,
    expiresAt: 1000,
  };

  expect(wallet.claim(quote, 1)).toEqual({ status: 'claimed' });
  expect(wallet.claim(quote, 1)).toEqual({ status: 'submitting' });
  wallet.finish(quote.id, { status: 'unknown' });
  expect(wallet.claim(quote, 1)).toEqual({ status: 'unknown' });
  expect(wallet.balance()).toBe(326427);
});

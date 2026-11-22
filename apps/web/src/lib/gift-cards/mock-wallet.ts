import type { GiftCardPurchaseStatus, GiftCardWallet } from './checkout';

export function createMockGiftCardWallet(initialBalanceKobo: number) {
  let balance = initialBalanceKobo;
  const purchases = new Map<string, GiftCardPurchaseStatus>();

  return {
    balance: () => balance,
    claim(quote, now) {
      const existing = purchases.get(quote.id);
      // A concurrent confirmation sees pending immediately. A later replay
      // sees the settled result, and neither can initiate another submission.
      if (existing) return existing;
      if (
        now >= quote.expiresAt ||
        !Number.isSafeInteger(quote.totalKobo) ||
        quote.totalKobo <= 0
      ) {
        return { status: 'expired' };
      }
      if (balance < quote.totalKobo) return { status: 'insufficient' };

      balance -= quote.totalKobo;
      purchases.set(quote.id, { status: 'submitting' });
      return { status: 'claimed' };
    },
    finish(id, result) {
      purchases.set(id, result);
    },
  } satisfies GiftCardWallet & { balance: () => number };
}

import { piggyvestWalletCovers } from './piggyvest-wallet-covers';

const ready = { balance: 0, primary_balance_kobo: 1_000_000 };

describe('piggyvestWalletCovers (switched on)', () => {
  it('covers when store credit is short and the PiggyVest wallet is not', () => {
    expect(
      piggyvestWalletCovers({ canPay: true, wallet: ready, price: 500 })
    ).toBe(true);
  });

  it('keeps store credit first and refuses a short PiggyVest wallet', () => {
    expect(
      piggyvestWalletCovers({
        canPay: true,
        wallet: { ...ready, balance: 500 },
        price: 500,
      })
    ).toBe(false);
    expect(
      piggyvestWalletCovers({ canPay: true, wallet: ready, price: 20_000 })
    ).toBe(false);
  });

  it('never trusts a stale, pending, unavailable or unresolved balance', () => {
    for (const hold of [
      { primary_stale: true },
      { primary_pending: true },
      { primary_unavailable: true },
      { owner_unresolved: true },
    ])
      expect(
        piggyvestWalletCovers({
          canPay: true,
          wallet: { ...ready, ...hold },
          price: 500,
        })
      ).toBe(false);
  });

  it('refuses a missing or non-positive price', () => {
    expect(
      piggyvestWalletCovers({ canPay: true, wallet: ready, price: 0 })
    ).toBe(false);
    expect(
      piggyvestWalletCovers({ canPay: true, wallet: ready, price: Number.NaN })
    ).toBe(false);
  });
});

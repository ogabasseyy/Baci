import { piggyvestWalletCovers } from './piggyvest-wallet-covers';

const ready = { balance: 0, primary_balance_kobo: 1_000_000 };

describe('piggyvestWalletCovers', () => {
  it('never covers anything while paying from PiggyVest is switched off', () => {
    expect(
      piggyvestWalletCovers({ canPay: false, wallet: ready, price: 500 })
    ).toBe(false);
  });

  it('never covers a customer the server sent no PiggyVest verdict for', () => {
    expect(
      piggyvestWalletCovers({
        canPay: true,
        wallet: { balance: 0 },
        price: 500,
      })
    ).toBe(false);
    expect(
      piggyvestWalletCovers({ canPay: true, wallet: null, price: 500 })
    ).toBe(false);
  });
});

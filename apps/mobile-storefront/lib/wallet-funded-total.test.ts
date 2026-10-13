import { resolveWalletFundedTotal } from './wallet-funded-total';

describe('resolveWalletFundedTotal', () => {
  it('prefers the routed order total', () => {
    expect(
      resolveWalletFundedTotal({
        orderTotal: 5000,
        targetOrderAmount: 3000,
        amount: 1000,
      })
    ).toBe(5000);
  });

  it('falls back to the intent target when the routed total is null', () => {
    expect(
      resolveWalletFundedTotal({ orderTotal: null, targetOrderAmount: 3000 })
    ).toBe(3000);
  });

  it('treats null and blank values as absent at every stage', () => {
    expect(
      resolveWalletFundedTotal({
        orderTotal: null,
        targetOrderAmount: '',
        amount: '  ',
      })
    ).toBe(0);
    expect(
      resolveWalletFundedTotal({
        orderTotal: null,
        targetOrderAmount: null,
        amount: 1200,
      })
    ).toBe(1200);
  });

  it('accepts numeric strings but rejects non-numeric input', () => {
    expect(resolveWalletFundedTotal({ orderTotal: '4500' })).toBe(4500);
    expect(resolveWalletFundedTotal({ orderTotal: 'n/a' })).toBe(0);
  });
});

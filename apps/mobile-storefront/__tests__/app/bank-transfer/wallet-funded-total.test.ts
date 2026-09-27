import { describe, expect, it } from '@jest/globals';
import { resolveWalletFundedTotal } from '@/lib/wallet-funded-total';

describe('resolveWalletFundedTotal', () => {
  it('prefers the routed canonical total over the post-savings residual', () => {
    // Savings credit reduced the funding intent target to 4000, but the
    // completion must still report the full 5000 order value.
    expect(
      resolveWalletFundedTotal({
        orderTotal: '5000',
        targetOrderAmount: '4000',
        amount: '3500',
      })
    ).toBe(5000);
  });

  it('falls back to the intent target when the route omits the total', () => {
    expect(
      resolveWalletFundedTotal({
        orderTotal: undefined,
        targetOrderAmount: '4000',
        amount: '3500',
      })
    ).toBe(4000);
  });

  it('falls back to the shortfall only as a last resort', () => {
    expect(
      resolveWalletFundedTotal({
        orderTotal: undefined,
        targetOrderAmount: undefined,
        amount: '3500',
      })
    ).toBe(3500);
  });

  it('reports zero when nothing is finite', () => {
    expect(
      resolveWalletFundedTotal({
        orderTotal: undefined,
        targetOrderAmount: undefined,
        amount: undefined,
      })
    ).toBe(0);
  });
});

import { chooseImeiPaymentRail } from './choose-imei-payment-rail';

const base = {
  retainedStoreCredit: false,
  piggyvestCovers: false,
  walletBalance: 0,
  price: 1000,
};

describe('chooseImeiPaymentRail', () => {
  it('pays from PiggyVest when it covers the check', () => {
    expect(chooseImeiPaymentRail({ ...base, piggyvestCovers: true })).toBe(
      'piggyvest'
    );
  });

  it('asks for a top-up when store credit is short and PiggyVest does not pay', () => {
    expect(chooseImeiPaymentRail(base)).toBe('top_up');
  });

  it('pays from store credit when it covers the check', () => {
    expect(chooseImeiPaymentRail({ ...base, walletBalance: 1000 })).toBe(
      'store_credit'
    );
  });

  it('bugfix: replays a retained store credit request instead of switching rails (Codex P1)', () => {
    expect(
      chooseImeiPaymentRail({
        ...base,
        retainedStoreCredit: true,
        piggyvestCovers: true,
      })
    ).toBe('store_credit');
  });
});

describe('bugfix: a kept PiggyVest attempt fell through to store credit (Codex P1)', () => {
  it('replays a kept PiggyVest attempt even when PiggyVest no longer covers it', () => {
    expect(
      chooseImeiPaymentRail({
        retainedStoreCredit: false,
        retainedPiggyvest: true,
        piggyvestCovers: false,
        walletBalance: 10_000,
        price: 500,
      })
    ).toBe('piggyvest');
  });

  it('still replays a kept store credit attempt first', () => {
    expect(
      chooseImeiPaymentRail({
        retainedStoreCredit: true,
        retainedPiggyvest: true,
        piggyvestCovers: true,
        walletBalance: 10_000,
        price: 500,
      })
    ).toBe('store_credit');
  });
});

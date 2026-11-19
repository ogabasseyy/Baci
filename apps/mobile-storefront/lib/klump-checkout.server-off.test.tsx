import {
  getKlumpDisabledReason,
  shouldHideKlumpPaymentMethod,
} from './klump-checkout';

const settings = {
  klump_enabled: true,
  klump_max_amount: 500000,
  klump_min_amount: 10000,
};

describe('klump checkout helpers', () => {
  it('rejects and hides retired Klump regardless of saved settings, credit or amount', () => {
    for (const amount of [5000, 120000, 1000001, Number.NaN]) {
      for (const staleSettings of [undefined, null, settings]) {
        expect(getKlumpDisabledReason(staleSettings, amount)).toBe(
          'Klump is no longer available. Choose another payment method.'
        );
        expect(
          getKlumpDisabledReason(staleSettings, amount, {
            use: true,
            amount: 5000,
          })
        ).toBe('Klump is no longer available. Choose another payment method.');
        expect(shouldHideKlumpPaymentMethod(staleSettings, amount)).toBe(true);
      }
    }
  });

  it('keeps Klump unavailable with server-disabled wallet and savings selections', () => {
    expect(
      getKlumpDisabledReason(
        settings,
        120000,
        { use: false, amount: 0 },
        { use: false, amount: 0, goalId: null }
      )
    ).toBe('Klump is no longer available. Choose another payment method.');
    expect(shouldHideKlumpPaymentMethod(settings, 120000)).toBe(true);
  });
});

import {
  getKlumpDisabledReason,
  shouldHideKlumpPaymentMethod,
} from './klump-checkout';

describe('klump checkout helpers with PiggyVest off', () => {
  const enabledSettings = {
    klump_enabled: true,
    klump_max_amount: 500_000,
    klump_min_amount: 10_000,
  };

  it('keeps Klump available for a positive net payable balance', () => {
    expect(shouldHideKlumpPaymentMethod(enabledSettings, 35_000)).toBe(false);
    expect(getKlumpDisabledReason(enabledSettings, 35_000)).toBeUndefined();
  });

  it('hides Klump above max and disables Klump when no payable balance remains', () => {
    expect(shouldHideKlumpPaymentMethod(enabledSettings, 600_000)).toBe(true);
    expect(shouldHideKlumpPaymentMethod(enabledSettings, 0)).toBe(false);
    expect(getKlumpDisabledReason(enabledSettings, 0)).toBe(
      'No payable balance remains for Klump checkout'
    );
  });
});

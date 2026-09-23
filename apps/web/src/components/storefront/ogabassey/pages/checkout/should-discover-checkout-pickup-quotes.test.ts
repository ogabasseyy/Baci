import { describe, expect, it } from 'vitest';
import { shouldDiscoverCheckoutPickupQuotes } from './should-discover-checkout-pickup-quotes';

describe('bugfix: discover merchant pickup rates before hiding the tab', () => {
  it('discovers pickup while still on door when only city and state are known', () => {
    expect(
      shouldDiscoverCheckoutPickupQuotes({
        isStreetReady: false,
        hasCityState: true,
      })
    ).toBe(true);
  });

  it('does not discover pickup once the street is ready', () => {
    expect(
      shouldDiscoverCheckoutPickupQuotes({
        isStreetReady: true,
        hasCityState: true,
      })
    ).toBe(false);
  });
});

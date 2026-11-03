import { isPiggyvestPrimaryMerchant } from './is-piggyvest-primary-merchant';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from './piggyvest-primary-capability-cache';

beforeEach(() => {
  clearObservedPiggyvestPrimaryCapability();
});

// The server keeping PiggyVest off is observed as a negative verdict (or
// no verdict yet): every non-pilot merchant keeps the production routing.
describe('server keeps PiggyVest off', () => {
  it('does not route a merchant the server marked not ready', () => {
    observePiggyvestPrimaryCapability('another-merchant', false);
    expect(isPiggyvestPrimaryMerchant('another-merchant')).toBe(false);
  });

  it('does not route a merchant with no server verdict yet', () => {
    expect(isPiggyvestPrimaryMerchant('another-merchant')).toBe(false);
  });
});

import { isPiggyvestPrimaryMerchant } from './is-piggyvest-primary-merchant';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from './piggyvest-primary-capability-cache';

describe('PiggyVest primary wallet selection', () => {
  beforeEach(() => {
    clearObservedPiggyvestPrimaryCapability();
  });
  it('selects the Ogabassey merchant by exact identity', () => {
    expect(
      isPiggyvestPrimaryMerchant('6b5cb8a4-5575-456c-b936-8cdfae30db74')
    ).toBe(true);
  });
  it.each([
    undefined,
    null,
    '',
    'another-merchant',
  ])('does not switch unrelated merchants', (merchantId) => {
    expect(isPiggyvestPrimaryMerchant(merchantId)).toBe(false);
  });
  it('routes a merchant the server confirmed without an app release', () => {
    observePiggyvestPrimaryCapability('another-merchant', true);
    expect(isPiggyvestPrimaryMerchant('another-merchant')).toBe(true);
  });
  it('ignores a negative server observation for the pilot fallback', () => {
    observePiggyvestPrimaryCapability('another-merchant', false);
    expect(isPiggyvestPrimaryMerchant('another-merchant')).toBe(false);
  });
});

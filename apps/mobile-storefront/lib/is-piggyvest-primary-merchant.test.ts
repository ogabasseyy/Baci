import { isPiggyvestPrimaryMerchant } from './is-piggyvest-primary-merchant';

describe('PiggyVest primary wallet selection', () => {
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
});

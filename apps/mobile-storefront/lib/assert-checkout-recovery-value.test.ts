import { assertCheckoutRecoveryValue } from './assert-checkout-recovery-value';

describe('assertCheckoutRecoveryValue', () => {
  it('accepts a non-empty recovery value', () => {
    expect(() =>
      assertCheckoutRecoveryValue(
        '46ed63d7-5f10-49f0-9456-9ff571bec43f',
        'generation'
      )
    ).not.toThrow();
  });

  it('rejects a blank recovery value', () => {
    expect(() => assertCheckoutRecoveryValue('   ', 'generation')).toThrow(
      'Checkout recovery generation is invalid. Please contact support.'
    );
  });
});

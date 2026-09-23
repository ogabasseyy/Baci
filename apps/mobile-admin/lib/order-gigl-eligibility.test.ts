import { describe, expect, it } from 'vitest';
import { isGiglAdminShippingEligible } from './order-gigl-eligibility';

describe('isGiglAdminShippingEligible', () => {
  it('enables the Admin GIGL wallet flow for NG/NGN merchants with GIGL enabled', () => {
    expect(
      isGiglAdminShippingEligible({
        country: 'ng',
        payoutCurrency: 'ngn',
        shippingProviders: ['topship', 'gigl'],
        settingsReady: true,
      })
    ).toBe(true);
  });

  it('treats a legacy null country as Nigeria for eligible NGN merchants', () => {
    expect(
      isGiglAdminShippingEligible({
        country: null,
        payoutCurrency: 'NGN',
        shippingProviders: ['gigl'],
        settingsReady: true,
      })
    ).toBe(true);
  });

  it('treats a blank payout currency as NGN for eligible Nigerian merchants', () => {
    expect(
      isGiglAdminShippingEligible({
        country: 'NG',
        payoutCurrency: '   ',
        shippingProviders: ['gigl'],
        settingsReady: true,
      })
    ).toBe(true);
  });

  it.each([
    { country: 'GH', payoutCurrency: 'NGN', shippingProviders: ['gigl'] },
    { country: 'NG', payoutCurrency: 'GHS', shippingProviders: ['gigl'] },
    { country: 'NG', payoutCurrency: 'NGN', shippingProviders: ['topship'] },
  ])('does not enable an ineligible merchant: %j', (input) => {
    expect(isGiglAdminShippingEligible({ ...input, settingsReady: true })).toBe(
      false
    );
  });

  it('fails closed while shipping settings are loading or errored', () => {
    expect(
      isGiglAdminShippingEligible({
        country: 'NG',
        payoutCurrency: 'NGN',
        shippingProviders: ['gigl'],
        settingsReady: false,
      })
    ).toBe(false);
  });

  it('inherits the default GIGL providers when settings providers are null', () => {
    expect(
      isGiglAdminShippingEligible({
        country: 'NG',
        payoutCurrency: 'NGN',
        shippingProviders: null,
        settingsReady: true,
      })
    ).toBe(true);
  });

  it('keeps an explicit empty provider list ineligible', () => {
    expect(
      isGiglAdminShippingEligible({
        country: 'NG',
        payoutCurrency: 'NGN',
        shippingProviders: [],
        settingsReady: true,
      })
    ).toBe(false);
  });
});

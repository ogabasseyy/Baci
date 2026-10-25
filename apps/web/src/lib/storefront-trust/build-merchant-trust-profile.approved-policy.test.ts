import { describe, expect, it } from 'vitest';
import { buildMerchantTrustProfile } from './build-merchant-trust-profile';

const stalePolicy = {
  return_policy: {
    summary: 'Unused items can be returned within seven days.',
    window_days: 7,
    return_method: 'in_store' as const,
    return_fees: 'free' as const,
  },
  warranty_policy: { summary: 'Manufacturer warranty only for new devices.' },
  shipping_policy: {
    summary:
      'Nationwide delivery; eligible Lagos delivery is free. Other rates are confirmed at checkout.',
    regions: ['Lagos, Nigeria'],
    shipping_fee_type: 'free' as const,
  },
};

describe('owner-approved Ogabassey policies', () => {
  it('publishes the approved 14-day defect return and one-year merchant warranty instead of stale copy', () => {
    const merchant = { slug: 'ogabassey', trust_profile: stalePolicy };
    const profile = buildMerchantTrustProfile(
      merchant,
      'https://ogabassey.com'
    );
    expect(profile.returnPolicy?.windowDays).toBe(14);
    expect(profile.returnPolicy?.summary).toContain('defects');
    expect(profile.returnPolicy?.summary).not.toContain('Unused');
    expect(profile.returnPolicy?.returnMethod).toBeUndefined();
    expect(profile.returnPolicy?.returnFees).toBeUndefined();
    expect(profile.warrantyPolicy?.summary).toContain('one-year');
    for (const exclusion of [
      'power surges',
      'screen damage',
      'liquid damage',
    ]) {
      expect(profile.warrantyPolicy?.summary).toContain(exclusion);
    }
    expect(profile.derivedLinks.warranty).toBe(
      'https://ogabassey.com/warranty'
    );
    expect(profile.shippingPolicy?.regions).toEqual(['Nigeria']);
    expect(profile.shippingPolicy?.shippingFeeType).toBe('calculated');
  });

  it('does not apply Ogabassey business promises to a tenant using the same template or base URL', () => {
    const merchant = {
      slug: 'another-store',
      template_id: 'ogabassey',
      trust_profile: stalePolicy,
    };
    const profile = buildMerchantTrustProfile(
      merchant,
      'https://ogabassey.com'
    );
    expect(profile.returnPolicy?.windowDays).toBe(7);
    expect(profile.warrantyPolicy?.summary).toBe(
      stalePolicy.warranty_policy.summary
    );
    expect(profile.shippingPolicy?.regions).toEqual(['Lagos, Nigeria']);
  });

  it('makes approved policies available without stale persisted policy data', () => {
    const profile = buildMerchantTrustProfile({ slug: 'ogabassey' });
    expect(profile.returnPolicy?.windowDays).toBe(14);
    expect(profile.derivedLinks.returns).toBe('/returns');
    expect(profile.derivedLinks.warranty).toBe('/warranty');
  });
});

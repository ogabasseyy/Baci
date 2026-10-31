import { describe, expect, it } from 'vitest';
import type { CachedMerchant } from '@/lib/cached-data';
import { getStorefrontProfileValues } from './storefront-profile-values';

const merchant = {
  business_name: 'Merchant A',
  country: 'GH',
  phone: '+2348031234567',
  site_description: 'Useful goods.',
  support_email: 'support@example.com',
  support_phone: '+2348000000000',
} as CachedMerchant;

describe('getStorefrontProfileValues', () => {
  it('loads the current business phone with the rest of the profile', () => {
    expect(getStorefrontProfileValues(merchant)).toEqual({
      business_name: 'Merchant A',
      country: 'GH',
      phone: '+2348031234567',
      site_description: 'Useful goods.',
      support_email: 'support@example.com',
      support_phone: '+2348000000000',
    });
  });

  it('turns missing values into blanks and defaults the country to NG', () => {
    const blank = {
      ...merchant,
      business_name: '',
      country: undefined,
      phone: null,
      site_description: '',
      support_email: null,
      support_phone: undefined,
    } as unknown as CachedMerchant;

    expect(getStorefrontProfileValues(blank)).toEqual({
      business_name: '',
      country: 'NG',
      phone: '',
      site_description: '',
      support_email: '',
      support_phone: '',
    });
  });
});

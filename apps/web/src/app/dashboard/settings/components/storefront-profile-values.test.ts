import { describe, expect, it } from 'vitest';
import type { CachedMerchant } from '@/lib/cached-data';
import {
  getStorefrontProfileValues,
  isStorefrontProfileValueChanged,
} from './storefront-profile-values';

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

describe('isStorefrontProfileValueChanged', () => {
  it('treats a value equal to its baseline as unchanged', () => {
    expect(isStorefrontProfileValueChanged('+23415781', '+23415781')).toBe(
      false
    );
  });

  it('treats a blank value against a missing baseline as unchanged', () => {
    expect(isStorefrontProfileValueChanged('', null)).toBe(false);
    expect(isStorefrontProfileValueChanged('', undefined)).toBe(false);
  });

  it('never treats a field the submission did not carry as changed', () => {
    expect(isStorefrontProfileValueChanged(undefined, '+2348031234567')).toBe(
      false
    );
  });

  it('treats an edited or cleared value as changed', () => {
    expect(isStorefrontProfileValueChanged('+2341578', '+23415781')).toBe(true);
    expect(isStorefrontProfileValueChanged('', '+23415781')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeMerchantRateOrderAddress } from './normalize-merchant-rate-order-address';

const malformedAddress = {
  address: '2 Olaide Tomori Street, Ikeja, Lagos 100001, Nigeria',
  city: 'Ikeja',
  state: '100001',
  country: 'Nigeria',
  countryCode: 'NG',
  postalCode: undefined,
};

describe('normalizeMerchantRateOrderAddress', () => {
  it('normalizes a merchant-rate destination before validation and persistence', () => {
    const result = normalizeMerchantRateOrderAddress(malformedAddress, true);

    expect(result).toEqual({ ...malformedAddress, state: 'Lagos' });
  });

  it('does not alter destinations outside the merchant-rate flow', () => {
    expect(normalizeMerchantRateOrderAddress(malformedAddress, false)).toBe(
      malformedAddress
    );
  });

  it('skips repair when the street address is missing', () => {
    const withoutStreet = {
      address: undefined as unknown as string,
      city: 'Ikeja',
      state: '100001',
      country: 'Nigeria',
      countryCode: 'NG',
      postalCode: undefined,
    };

    expect(normalizeMerchantRateOrderAddress(withoutStreet, true)).toBe(
      withoutStreet
    );
  });
});

import { describe, expect, it } from 'vitest';
import { buildMerchantSenderInfo } from './merchant-sender-location';

describe('buildMerchantSenderInfo', () => {
  it('uses the structured city and state code instead of a postal code', () => {
    const sender = buildMerchantSenderInfo({
      businessAddress: '2 Olaide Tomori Street, Ikeja, 100001',
      businessName: 'Ogabassey',
      phone: '08000000000',
      registeredAddress: {
        city: 'Ikeja',
        country: 'Nigeria',
        postal_code: '100001',
        state: null,
        street: '2 Olaide Tomori Street',
      },
      stateCode: 'LA',
    });

    expect(sender).toMatchObject({
      city: 'Ikeja',
      country: 'Nigeria',
      countryCode: 'NG',
      state: 'Lagos',
    });
  });

  it('normalizes the FCT subdivision code for GIGL station matching', () => {
    const sender = buildMerchantSenderInfo({
      businessAddress: '29 Yedseram Crescent, Maitama, 904101',
      businessName: 'Merchant',
      phone: '08000000000',
      registeredAddress: {
        city: 'Maitama',
        country: 'Nigeria',
        postal_code: '904101',
        state: null,
      },
      stateCode: 'FC',
    });

    expect(sender?.state).toBe('Abuja');
  });

  it('canonicalizes structured Abuja (FCT) state labels for GIGL station matching', () => {
    const sender = buildMerchantSenderInfo({
      businessAddress: '29 Yedseram Crescent, Maitama, 904101',
      businessName: 'Merchant',
      phone: '08000000000',
      registeredAddress: {
        city: 'Maitama',
        country: 'Nigeria',
        postal_code: '904101',
        state: 'Abuja (FCT)',
        street: '29 Yedseram Crescent',
      },
      stateCode: 'FC',
    });

    expect(sender?.state).toBe('Abuja');
    expect(sender?.state).not.toBe('Abuja (FCT)');
  });

  it('preserves numeric registered postal codes', () => {
    const sender = buildMerchantSenderInfo({
      businessAddress: null,
      businessName: 'Merchant',
      phone: '08000000000',
      registeredAddress: {
        city: 'Ikeja',
        country: 'Nigeria',
        postal_code: 100001,
        state: 'Lagos',
        street: '2 Olaide Tomori Street',
      },
      stateCode: 'LA',
    });

    expect(sender?.postalCode).toBe('100001');
  });

  it('does not combine a business street with a divergent registered locality', () => {
    const sender = buildMerchantSenderInfo({
      businessAddress: '12 Allen Avenue, Ikeja, Lagos',
      businessName: 'Merchant',
      phone: '08000000000',
      registeredAddress: {
        city: 'Maitama',
        country: 'Nigeria',
        postal_code: '904101',
        state: 'Abuja',
        street: '29 Yedseram Crescent',
      },
      stateCode: 'LA',
    });

    expect(sender).toMatchObject({
      address: '12 Allen Avenue, Ikeja, Lagos',
      city: 'Ikeja',
      state: 'Lagos',
    });
    expect(sender?.postalCode).toBeUndefined();
  });
});

describe('bugfix: reject empty registered origin', () => {
  it('returns null when business_address and registered_address are both empty', () => {
    // Arrange: no usable origin; state_code alone must not fabricate Lagos
    const sender = buildMerchantSenderInfo({
      businessAddress: null,
      businessName: 'Merchant',
      phone: '08000000000',
      registeredAddress: null,
      stateCode: 'FC',
    });

    // Act / Assert: fail closed instead of Lagos fallback
    expect(sender).toBeNull();
  });

  it('returns null when registered_address has no usable fields', () => {
    const sender = buildMerchantSenderInfo({
      businessAddress: '   ',
      businessName: 'Merchant',
      phone: '08000000000',
      registeredAddress: { city: null, state: null, street: null },
      stateCode: 'LA',
    });

    expect(sender).toBeNull();
  });
});

describe('bugfix: prefer business_address state over stale state_code', () => {
  it('returns Lagos when business_address ends in Lagos but state_code is FC', () => {
    const sender = buildMerchantSenderInfo({
      businessAddress: '2 Olaide Tomori Street, Ikeja, Lagos',
      businessName: 'Merchant',
      phone: '08000000000',
      registeredAddress: null,
      stateCode: 'FC',
    });

    expect(sender).toMatchObject({
      city: 'Ikeja',
      state: 'Lagos',
    });
    expect(sender?.state).not.toBe('Abuja');
  });
});

describe('bugfix: legacy free-text-only merchant address', () => {
  it('uses the state code when a locality is mistaken for a state', () => {
    const sender = buildMerchantSenderInfo({
      businessAddress: '29 Yedseram Crescent, Maitama',
      businessName: 'Merchant',
      phone: '08000000000',
      registeredAddress: null,
      stateCode: 'FC',
    });

    expect(sender).toMatchObject({
      city: 'Maitama',
      state: 'Abuja',
    });
  });

  it('does not default Abuja merchants to Lagos when business_address ends in a postal code', () => {
    const sender = buildMerchantSenderInfo({
      businessAddress: '29 Yedseram Crescent, Maitama, 904101',
      businessName: 'Merchant',
      phone: '08000000000',
      registeredAddress: null,
      stateCode: null,
    });

    expect(sender).toMatchObject({
      city: 'Maitama',
      state: 'Abuja',
    });
    expect(sender?.state).not.toBe('Lagos');
  });

  it('preserves the city from a street, city, state, postal_code business address', () => {
    const sender = buildMerchantSenderInfo({
      businessAddress: '2 Olaide Tomori Street, Ikeja, Lagos, 100001',
      businessName: 'Merchant',
      phone: '08000000000',
      registeredAddress: null,
      stateCode: 'LA',
    });

    expect(sender).toMatchObject({
      city: 'Ikeja',
      state: 'Lagos',
    });
    expect(sender?.city).not.toBe('Lagos');
  });
});

describe('bugfix: state-level registered city with empty state', () => {
  const quotePathSender = (details: {
    businessAddress: string;
    stateCode: string | null;
  }) =>
    buildMerchantSenderInfo({
      businessAddress: details.businessAddress,
      businessName: 'Merchant',
      phone: '08000000000',
      registeredAddress: null,
      stateCode: details.stateCode,
    });

  const bookingPathSender = (details: {
    businessAddress: string;
    registeredAddress: {
      city: string;
      postal_code?: string;
      state: string | null;
      street: string;
    };
    stateCode: string | null;
  }) =>
    buildMerchantSenderInfo({
      businessAddress: details.businessAddress,
      businessName: 'Merchant',
      phone: '08000000000',
      registeredAddress: details.registeredAddress,
      stateCode: details.stateCode,
    });

  it('aligns Lagos quote and booking senders on the parsed locality city', () => {
    const businessAddress = '2 Olaide Tomori Street, Ikeja, Lagos, 100001';

    const quoteSender = quotePathSender({
      businessAddress,
      stateCode: 'LA',
    });
    const bookingSender = bookingPathSender({
      businessAddress,
      registeredAddress: {
        city: 'Lagos',
        postal_code: '100001',
        state: null,
        street: '2 Olaide Tomori Street',
      },
      stateCode: 'LA',
    });

    expect(quoteSender).toMatchObject({
      city: 'Ikeja',
      state: 'Lagos',
    });
    expect(bookingSender).toMatchObject({
      city: 'Ikeja',
      state: 'Lagos',
    });
    expect(bookingSender?.city).toBe(quoteSender?.city);
  });

  it('aligns Abuja quote and booking senders on the parsed locality city', () => {
    const businessAddress = '29 Yedseram Crescent, Maitama, 904101';

    const quoteSender = quotePathSender({
      businessAddress,
      stateCode: 'FC',
    });
    const bookingSender = bookingPathSender({
      businessAddress,
      registeredAddress: {
        city: 'Abuja',
        postal_code: '904101',
        state: null,
        street: '29 Yedseram Crescent',
      },
      stateCode: 'FC',
    });

    expect(quoteSender).toMatchObject({
      city: 'Maitama',
      state: 'Abuja',
    });
    expect(bookingSender).toMatchObject({
      city: 'Maitama',
      state: 'Abuja',
    });
    expect(bookingSender?.city).toBe(quoteSender?.city);
  });
});

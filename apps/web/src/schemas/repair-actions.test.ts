import { describe, expect, it } from 'vitest';
import {
  repairBookingSearchParamsSchema,
  repairMerchantIdentifierSchema,
  repairMerchantIdSchema,
  repairPickupExpectedFeeSchema,
  repairPlaceDetailsSchema,
} from './repair-actions';

describe('repairMerchantIdSchema', () => {
  it('accepts a valid uuid', () => {
    const result = repairMerchantIdSchema.safeParse(
      '123e4567-e89b-12d3-a456-426614174000'
    );

    expect(result.success).toBe(true);
  });

  it('rejects non-uuid merchant ids', () => {
    expect(repairMerchantIdSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(repairMerchantIdSchema.safeParse('').success).toBe(false);
    expect(repairMerchantIdSchema.safeParse(42).success).toBe(false);
  });
});

describe('repairMerchantIdentifierSchema', () => {
  it('trims and lowercases a valid storefront identifier', () => {
    const result = repairMerchantIdentifierSchema.safeParse('  OgaBassey  ');

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected identifier to parse');
    expect(result.data).toBe('ogabassey');
  });

  it('rejects blank, oversized, or non-string identifiers', () => {
    expect(repairMerchantIdentifierSchema.safeParse('').success).toBe(false);
    expect(repairMerchantIdentifierSchema.safeParse('   ').success).toBe(false);
    expect(repairMerchantIdentifierSchema.safeParse(42).success).toBe(false);
    expect(
      repairMerchantIdentifierSchema.safeParse('a'.repeat(121)).success
    ).toBe(false);
  });
});

describe('repairPickupExpectedFeeSchema', () => {
  it('coerces and accepts a positive pickup fee', () => {
    const result = repairPickupExpectedFeeSchema.safeParse('8250');

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected fee to parse');
    expect(result.data).toBe(8250);
  });

  it('rejects non-finite, non-positive, or oversized fees', () => {
    expect(repairPickupExpectedFeeSchema.safeParse(-1).success).toBe(false);
    expect(repairPickupExpectedFeeSchema.safeParse(0).success).toBe(false);
    expect(repairPickupExpectedFeeSchema.safeParse('pickup').success).toBe(
      false
    );
    expect(
      repairPickupExpectedFeeSchema.safeParse(Number.POSITIVE_INFINITY).success
    ).toBe(false);
    expect(repairPickupExpectedFeeSchema.safeParse(10_000_001).success).toBe(
      false
    );
  });
});

describe('repairPlaceDetailsSchema', () => {
  it('parses a complete place and preserves its fields', () => {
    const place = {
      streetNumber: '3',
      route: 'Olayeni Street',
      city: 'Ikeja',
      state: 'Lagos',
      zip: '100001',
      country: 'Nigeria',
      formattedAddress: '3 Olayeni Street, Ikeja, Lagos, Nigeria',
    };

    const result = repairPlaceDetailsSchema.safeParse(place);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected place to parse');
    expect(result.data).toEqual(place);
  });

  it('defaults non-required optional fields to empty strings', () => {
    const result = repairPlaceDetailsSchema.safeParse({
      city: 'Port Harcourt',
      state: 'Rivers',
      formattedAddress: '12 Aba Road, Port Harcourt, Rivers',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected place to parse');
    expect(result.data.streetNumber).toBe('');
    expect(result.data.country).toBe('');
  });

  it('rejects oversized field values', () => {
    const result = repairPlaceDetailsSchema.safeParse({
      city: 'Ikeja',
      state: 'Lagos',
      formattedAddress: 'a'.repeat(501),
    });

    expect(result.success).toBe(false);
  });

  it('rejects empty or incomplete pickup addresses', () => {
    expect(repairPlaceDetailsSchema.safeParse({}).success).toBe(false);
    expect(
      repairPlaceDetailsSchema.safeParse({
        formattedAddress: '12 Aba Road, Port Harcourt',
      }).success
    ).toBe(false);
    expect(
      repairPlaceDetailsSchema.safeParse({
        city: 'Port Harcourt',
        state: 'Rivers',
      }).success
    ).toBe(false);
  });

  it('rejects non-object payloads', () => {
    expect(repairPlaceDetailsSchema.safeParse(null).success).toBe(false);
    expect(repairPlaceDetailsSchema.safeParse('lagos').success).toBe(false);
  });
});

describe('repairBookingSearchParamsSchema', () => {
  it('accepts an empty object (no preselection)', () => {
    const result = repairBookingSearchParamsSchema.safeParse({});

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected empty params to parse');
    expect(result.data.device).toBeUndefined();
    expect(result.data.quote).toBeUndefined();
  });

  it('accepts a valid device slug and quote uuid', () => {
    const result = repairBookingSearchParamsSchema.safeParse({
      device: 'apple-iphone-13-pro-max',
      quote: '223e4567-e89b-12d3-a456-426614174999',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected params to parse');
    expect(result.data.device).toBe('apple-iphone-13-pro-max');
    expect(result.data.quote).toBe('223e4567-e89b-12d3-a456-426614174999');
  });

  it('accepts a device slug without a quote id', () => {
    const result = repairBookingSearchParamsSchema.safeParse({
      device: 'apple-iphone-13-pro-max',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a malformed device slug', () => {
    expect(
      repairBookingSearchParamsSchema.safeParse({ device: 'Not A Slug!' })
        .success
    ).toBe(false);
    expect(
      repairBookingSearchParamsSchema.safeParse({ device: '../../etc/passwd' })
        .success
    ).toBe(false);
  });

  it('rejects a non-uuid quote id', () => {
    expect(
      repairBookingSearchParamsSchema.safeParse({
        device: 'apple-iphone-13-pro-max',
        quote: 'not-a-uuid',
      }).success
    ).toBe(false);
  });
});

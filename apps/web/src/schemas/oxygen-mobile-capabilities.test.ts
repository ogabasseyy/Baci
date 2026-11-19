import { expect, it } from 'vitest';
import {
  oxygenMobileCapabilitiesQuerySchema,
  oxygenMobileReadinessRowSchema,
} from './oxygen-mobile-capabilities';

it('accepts only the merchant slug in the capability query', () => {
  expect(
    oxygenMobileCapabilitiesQuerySchema.safeParse({ merchantSlug: 'shop-one' })
      .success
  ).toBe(true);
  expect(
    oxygenMobileCapabilitiesQuerySchema.safeParse({
      merchantSlug: 'shop-one',
      environment: 'staging',
    }).success
  ).toBe(false);
  expect(
    oxygenMobileCapabilitiesQuerySchema.safeParse({ merchantSlug: '../shop' })
      .success
  ).toBe(false);
});

it('accepts absent provider binding and rejects invalid runtime values', () => {
  const row = {
    merchant_id: '123e4567-e89b-12d3-a456-426614174000',
    merchant_slug: 'shop-one',
    environment: null,
    binding_ready: false,
  };
  expect(oxygenMobileReadinessRowSchema.safeParse(row).success).toBe(true);
  expect(
    oxygenMobileReadinessRowSchema.safeParse({ ...row, environment: 'qa' })
      .success
  ).toBe(false);
  expect(
    oxygenMobileReadinessRowSchema.safeParse({ ...row, binding_ready: 'true' })
      .success
  ).toBe(false);
});

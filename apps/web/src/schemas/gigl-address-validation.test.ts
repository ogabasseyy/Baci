import { describe, expect, it } from 'vitest';
import {
  giglAddressValidationDataSchema,
  homeDeliveryCoverageSchema,
} from './gigl-address-validation';

describe('GIG address validation response', () => {
  it.each([true, false])('preserves explicit coverage %s', (supported) => {
    expect(
      giglAddressValidationDataSchema.parse({ HomeDeliveryStatus: supported })
    ).toEqual({ HomeDeliveryStatus: supported });
  });

  it.each([
    undefined,
    null,
    'true',
    'false',
    0,
    1,
    {},
  ])('does not infer coverage from %j', (value) => {
    expect(
      giglAddressValidationDataSchema.safeParse({ HomeDeliveryStatus: value })
        .success
    ).toBe(false);
  });
});

describe('home delivery coverage', () => {
  it.each([
    'supported',
    'unsupported',
    'unavailable',
  ])('accepts the explicit %s state', (value) => {
    expect(homeDeliveryCoverageSchema.parse(value)).toBe(value);
  });

  it.each([
    undefined,
    null,
    true,
    false,
    'unknown',
    'Supported',
  ])('rejects an unrecognized state %j', (value) => {
    expect(homeDeliveryCoverageSchema.safeParse(value).success).toBe(false);
  });
});
